import type { FastifyInstance } from 'fastify';
import type { AuthUser } from './shared/auth.js';
import { fail } from './shared/response.js';

const scopedPrefixes = [
  '/performance',
  '/dashboard',
  '/workspace',
  '/campaigns',
  '/meta/status',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

    if (!user.clientId) {
      return reply.code(403).send(fail('CLIENT_SCOPE_REQUIRED', 'Este usuário precisa estar vinculado a uma empresa.'));
    }
    if (!user.businessId) {
      return reply.code(403).send(fail('BUSINESS_SCOPE_REQUIRED', 'Este usuário precisa estar vinculado a uma Business Manager.'));
    }

    if (isObject(req.query)) {
      const requestedClient = req.query.clientId;
      const requestedBusiness = req.query.businessId;
      if (requestedClient && requestedClient !== user.clientId) {
        return reply.code(403).send(fail('FORBIDDEN', 'Empresa fora do escopo deste usuário.'));
      }
      if (requestedBusiness && requestedBusiness !== user.businessId) {
        return reply.code(403).send(fail('FORBIDDEN', 'Business Manager fora do escopo deste usuário.'));
      }
      req.query.clientId = user.clientId;
      req.query.businessId = user.businessId;
    }

    if (isObject(req.body)) {
      const requestedClient = req.body.clientId;
      const requestedBusiness = req.body.businessId;
      if (requestedClient && requestedClient !== user.clientId) {
        return reply.code(403).send(fail('FORBIDDEN', 'Empresa fora do escopo deste usuário.'));
      }
      if (requestedBusiness && requestedBusiness !== user.businessId) {
        return reply.code(403).send(fail('FORBIDDEN', 'Business Manager fora do escopo deste usuário.'));
      }
      req.body.clientId = user.clientId;
      req.body.businessId = user.businessId;
    }
  });
}
