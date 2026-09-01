import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';
import { fail } from './response.js';

export interface AuthUser {
  id: string;
  role: string;
  organizationId?: string;
  clientId?: string;
  businessId?: string;
  clientIds?: string[];
}

const NO_CLIENT_SCOPE = '00000000-0000-0000-0000-000000000000';
const tenantRoles = new Set(['CLIENT', 'MANAGER']);

function jsonClientIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function uniqueClientIds(primary?: string | null, extra?: unknown) {
  return Array.from(new Set([
    ...(primary ? [primary] : []),
    ...jsonClientIds(extra),
  ]));
}

export function authorizedClientIds(user: AuthUser) {
  return Array.from(new Set([
    ...(user.clientId ? [user.clientId] : []),
    ...(Array.isArray(user.clientIds) ? user.clientIds : []),
  ].filter(Boolean))) as string[];
}

export function hasMultiClientAccess(user: AuthUser) {
  return tenantRoles.has(user.role) && authorizedClientIds(user).length > 1;
}

export function canAccessClient(user: AuthUser, clientId?: string | null) {
  if (!clientId) return false;
  if (!tenantRoles.has(user.role)) return true;
  return authorizedClientIds(user).includes(clientId);
}

export function canAccessBusiness(user: AuthUser, clientId?: string | null, businessId?: string | null) {
  if (!clientId || !canAccessClient(user, clientId)) return false;
  if (!tenantRoles.has(user.role)) return true;
  if (hasMultiClientAccess(user)) return true;
  return !businessId || businessId === user.businessId;
}

export function requireAuth(roles?: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const user = req.user as AuthUser;

      if (tenantRoles.has(user.role)) {
        const current = await prisma.user.findFirst({
          where: { id: user.id, isActive: true },
          select: { organizationId: true, clientId: true, businessId: true, clientIdsJson: true },
        });
        if (!current) throw new Error('Usuário inativo');

        user.organizationId = current.organizationId ?? user.organizationId;
        user.clientId = current.clientId ?? undefined;
        user.businessId = current.businessId ?? undefined;
        user.clientIds = uniqueClientIds(current.clientId, current.clientIdsJson);
      }

      if (roles && !roles.includes(user.role)) {
        return reply.code(403).send(fail('FORBIDDEN', 'Sem permissão para esta ação.'));
      }
    } catch {
      return reply.code(401).send(fail('UNAUTHORIZED', 'Autenticação necessária.'));
    }
  };
}

// CLIENT e MANAGER continuam presos às empresas explicitamente vinculadas.
// O clientId legado permanece como empresa principal; clientIds adiciona empresas extras.
// Para usuário legado de empresa única, uma tentativa de trocar o clientId continua
// sendo ignorada e mantém a empresa principal, exatamente como antes desta evolução.
export function scopeClient(user: AuthUser, requestedClientId?: string): string | undefined {
  if (tenantRoles.has(user.role)) {
    const allowed = authorizedClientIds(user);
    if (!allowed.length) return NO_CLIENT_SCOPE;
    if (allowed.length === 1) return allowed[0];
    if (requestedClientId) return allowed.includes(requestedClientId) ? requestedClientId : NO_CLIENT_SCOPE;
    return user.clientId && allowed.includes(user.clientId) ? user.clientId : allowed[0];
  }
  return requestedClientId;
}
