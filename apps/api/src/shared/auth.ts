import { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from './response.js';

export interface AuthUser {
  id: string; role: string; organizationId?: string; clientId?: string;
}

export function requireAuth(roles?: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const user = req.user as AuthUser;
      if (roles && !roles.includes(user.role)) {
        return reply.code(403).send(fail('FORBIDDEN', 'Sem permissão para esta ação.'));
      }
    } catch {
      return reply.code(401).send(fail('UNAUTHORIZED', 'Autenticação necessária.'));
    }
  };
}

// Multi-tenant: um CLIENT só enxerga o próprio clientId
export function scopeClient(user: AuthUser, requestedClientId?: string): string | undefined {
  if (user.role === 'CLIENT') return user.clientId;
  return requestedClientId; // admin/manager podem filtrar por qualquer cliente
}
