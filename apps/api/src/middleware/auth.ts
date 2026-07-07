import jwt, { type SignOptions } from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Role, UserStatus } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { isClientScopedRole } from '../services/accessControl.js';
import { assertTenantClient } from '../services/tenantScope.js';

export type AuthUser = {
  sub: string;
  userId: string;
  tenantId: string;
  clientId: string | null;
  role: Role;
  email: string;
  name: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function signToken(input: Omit<AuthUser, 'userId'> & { sub: string }) {
  const payload: AuthUser = { ...input, userId: input.sub };
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return reply.code(401).send({ message: 'Token ausente.' });

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    const user = await prisma.user.findFirst({
      where: { id: payload.sub, tenantId: payload.tenantId, status: UserStatus.ACTIVE },
      select: { id: true, tenantId: true, clientId: true, role: true, email: true, name: true }
    });
    if (!user) return reply.code(401).send({ message: 'Token invalido ou usuario inativo.' });
    request.user = {
      sub: user.id,
      userId: user.id,
      tenantId: user.tenantId,
      clientId: user.clientId,
      role: user.role,
      email: user.email,
      name: user.name
    };
  } catch {
    return reply.code(401).send({ message: 'Token expirado ou invalido.' });
  }
}

export function requireRoles(roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;
    if (!request.user || !roles.includes(request.user.role)) {
      return reply.code(403).send({ message: 'Acesso negado.' });
    }
  };
}

export async function resolveClientScope(request: FastifyRequest, requestedClientId?: string | null) {
  const user = request.user;
  if (!user) throw new Error('Usuario nao autenticado.');

  if (isClientScopedRole(user.role)) {
    if (!user.clientId) throw Object.assign(new Error('Usuario cliente sem cliente vinculado.'), { statusCode: 403 });
    return user.clientId;
  }

  if (!requestedClientId) return undefined;
  return assertTenantClient(user.tenantId, requestedClientId);
}

export async function assertClientAccess(request: FastifyRequest, clientId: string) {
  const scoped = await resolveClientScope(request, clientId);
  if (!scoped || scoped !== clientId) {
    throw Object.assign(new Error('Cliente fora do escopo permitido.'), { statusCode: 403 });
  }
  return scoped;
}
