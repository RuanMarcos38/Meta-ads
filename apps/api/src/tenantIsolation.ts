import type { FastifyInstance } from 'fastify';
import { prisma } from './shared/prisma.js';
import type { AuthUser } from './shared/auth.js';
import { fail } from './shared/response.js';

const scopedPrefixes = [
  '/performance',
  '/dashboard',
  '/workspace',
  '/campaigns',
  '/meta/status',
  '/meta/live',
];

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonClientIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function linkedClientIds(primary?: string | null, extra?: unknown) {
  return Array.from(new Set([...(primary ? [primary] : []), ...jsonClientIds(extra)]));
}

async function validateBusiness(organizationId: string, clientId: string, businessId: string) {
  return prisma.businessManager.findFirst({
    where: { organizationId, clientId, metaBusinessId: businessId, status: 'active' },
    select: { id: true },
  });
}

export async function registerTenantIsolation(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!scopedPrefixes.some((prefix) => req.url.startsWith(prefix))) return;
    if (!req.headers.authorization) return;

    try {
      await req.jwtVerify();
    } catch {
      return;
    }

    const user = req.user as AuthUser;
    if (user.role !== 'CLIENT' && user.role !== 'MANAGER') return;

    const current = await prisma.user.findFirst({
      where: { id: user.id, isActive: true },
      select: { organizationId: true, clientId: true, businessId: true, clientIdsJson: true },
    });
    if (!current?.organizationId) return reply.code(403).send(fail('CLIENT_SCOPE_REQUIRED', 'Este usuário precisa estar vinculado a uma empresa.'));

    const allowedClients = linkedClientIds(current.clientId, current.clientIdsJson);
    if (!allowedClients.length) return reply.code(403).send(fail('CLIENT_SCOPE_REQUIRED', 'Este usuário precisa estar vinculado a uma empresa.'));

    user.organizationId = current.organizationId;
    user.clientId = current.clientId || undefined;
    user.businessId = current.businessId || undefined;
    user.clientIds = allowedClients;

    const multiClient = allowedClients.length > 1;

    const requestedQueryClient = isObject(req.query) ? req.query.clientId : undefined;
    const requestedBodyClient = isObject(req.body) ? req.body.clientId : undefined;
    const requestedClient = requestedQueryClient || requestedBodyClient || current.clientId || allowedClients[0];
    if (!requestedClient || !allowedClients.includes(String(requestedClient))) {
      return reply.code(403).send(fail('FORBIDDEN', 'Empresa fora do escopo deste usuário.'));
    }
    const selectedClient = String(requestedClient);

    const requestedQueryBusiness = isObject(req.query) ? req.query.businessId : undefined;
    const requestedBodyBusiness = isObject(req.body) ? req.body.businessId : undefined;
    const requestedBusiness = requestedQueryBusiness || requestedBodyBusiness
      || (!multiClient && selectedClient === current.clientId ? current.businessId : undefined);

    if (requestedBusiness) {
      const validBusiness = await validateBusiness(current.organizationId, selectedClient, String(requestedBusiness));
      if (!validBusiness) {
        return reply.code(403).send(fail('FORBIDDEN', 'Business Manager fora da empresa selecionada ou não autorizada.'));
      }
    }

    if (isObject(req.query)) {
      req.query.clientId = selectedClient;
      if (requestedBusiness) req.query.businessId = String(requestedBusiness);
      else delete req.query.businessId;
    }
    if (isObject(req.body)) {
      req.body.clientId = selectedClient;
      if (requestedBusiness) req.body.businessId = String(requestedBusiness);
      else delete req.body.businessId;
    }
  });

  // O preHandler já restringe empresa e BM pelo vínculo ativo BusinessManager -> Client.
  // Não filtramos a resposta para apenas a BM principal, pois um mesmo cliente pode
  // possuir várias BMs explicitamente cadastradas no seu perfil.
}
