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
    if (!multiClient && !current.businessId) {
      return reply.code(403).send(fail('BUSINESS_SCOPE_REQUIRED', 'Este usuário precisa estar vinculado a uma Business Manager.'));
    }

    const requestedQueryClient = isObject(req.query) ? req.query.clientId : undefined;
    const requestedBodyClient = isObject(req.body) ? req.body.clientId : undefined;
    const requestedClient = requestedQueryClient || requestedBodyClient || current.clientId || allowedClients[0];
    if (!requestedClient || !allowedClients.includes(String(requestedClient))) {
      return reply.code(403).send(fail('FORBIDDEN', 'Empresa fora do escopo deste usuário.'));
    }
    const selectedClient = String(requestedClient);

    const requestedQueryBusiness = isObject(req.query) ? req.query.businessId : undefined;
    const requestedBodyBusiness = isObject(req.body) ? req.body.businessId : undefined;
    const requestedBusiness = requestedQueryBusiness || requestedBodyBusiness;

    if (!multiClient) {
      if (requestedBusiness && requestedBusiness !== current.businessId) {
        return reply.code(403).send(fail('FORBIDDEN', 'Business Manager fora do escopo deste usuário.'));
      }
      if (isObject(req.query)) {
        req.query.clientId = current.clientId;
        req.query.businessId = current.businessId;
      }
      if (isObject(req.body)) {
        req.body.clientId = current.clientId;
        req.body.businessId = current.businessId;
      }
      return;
    }

    if (requestedBusiness) {
      const validBusiness = await validateBusiness(current.organizationId, selectedClient, String(requestedBusiness));
      if (!validBusiness) return reply.code(403).send(fail('FORBIDDEN', 'Business Manager fora da empresa selecionada ou não autorizada.'));
    }

    if (isObject(req.query)) {
      req.query.clientId = selectedClient;
      if (!requestedQueryBusiness) delete req.query.businessId;
    }
    if (isObject(req.body)) {
      req.body.clientId = selectedClient;
      if (!requestedBodyBusiness) delete req.body.businessId;
    }
  });

  app.addHook('onSend', async (req, _reply, payload) => {
    if (!req.url.startsWith('/dashboard/context') && !req.url.startsWith('/meta/status')) return payload;
    const user = req.user as AuthUser | undefined;
    if (!user || (user.role !== 'CLIENT' && user.role !== 'MANAGER') || !user.businessId) return payload;

    // Usuário multiempresa já foi validado no preHandler por empresa/BM solicitada.
    // O filtro legado abaixo continua exclusivamente para usuários de empresa única.
    if (Array.isArray(user.clientIds) && user.clientIds.length > 1) return payload;

    try {
      const parsed = JSON.parse(Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload));
      if (!parsed?.success || !parsed?.data) return payload;

      if (req.url.startsWith('/dashboard/context')) {
        if (Array.isArray(parsed.data.accounts)) parsed.data.accounts = parsed.data.accounts.filter((item: any) => item.businessId === user.businessId);
        if (Array.isArray(parsed.data.businesses)) parsed.data.businesses = parsed.data.businesses.filter((item: any) => item.id === user.businessId);
      }

      if (req.url.startsWith('/meta/status')) {
        if (Array.isArray(parsed.data.accounts)) parsed.data.accounts = parsed.data.accounts.filter((item: any) => item.businessId === user.businessId);
      }

      return JSON.stringify(parsed);
    } catch {
      return payload;
    }
  });
}
