import { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from './response.js';

export interface AuthUser {
  id: string;
  role: string;
  organizationId?: string;
  clientId?: string;
  businessId?: string;
}

const NO_CLIENT_SCOPE = '00000000-0000-0000-0000-000000000000';

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

// CLIENT e MANAGER ficam presos ao clientId gravado no token.
// Se não houver clientId, usamos um UUID impossível em vez de cair no consolidado da organização.
// Somente administradores podem selecionar outro cliente da mesma organização.
export function scopeClient(user: AuthUser, requestedClientId?: string): string | undefined {
  if (user.role === 'CLIENT' || user.role === 'MANAGER') return user.clientId || NO_CLIENT_SCOPE;
  return requestedClientId;
}
