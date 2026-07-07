import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { Role, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRoles } from '../middleware/auth.js';
import { ADMIN_ROLES, INTERNAL_ROLES, canManageRole, canManageUser, isClientScopedRole } from '../services/accessControl.js';
import { logAudit } from '../services/audit.js';
import { assertTenantClient } from '../services/tenantScope.js';
import { randomToken } from '../utils/crypto.js';

function publicUser(user: any) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

async function resolveClientIdForRole(tenantId: string, role: Role, clientId?: string | null) {
  if (isClientScopedRole(role)) {
    if (!clientId) throw Object.assign(new Error('clientId e obrigatorio para usuario comum.'), { statusCode: 400 });
    return assertTenantClient(tenantId, clientId);
  }

  if (clientId) throw Object.assign(new Error('clientId deve ser usado apenas para usuario comum.'), { statusCode: 400 });
  return null;
}

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', { preHandler: requireRoles(INTERNAL_ROLES) }, async (request) => {
    const users = await prisma.user.findMany({
      where: { tenantId: request.user!.tenantId },
      select: { id: true, name: true, email: true, role: true, status: true, clientId: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    return { users };
  });

  app.post('/users', { preHandler: requireRoles(INTERNAL_ROLES) }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
      role: z.nativeEnum(Role),
      clientId: z.string().optional()
    }).parse(request.body);

    if (!canManageRole(request.user!.role, body.role)) {
      return reply.code(403).send({ message: 'Permissao insuficiente para criar este perfil.' });
    }

    const clientId = await resolveClientIdForRole(request.user!.tenantId, body.role, body.clientId);
    const user = await prisma.user.create({
      data: {
        tenantId: request.user!.tenantId,
        clientId,
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: await bcrypt.hash(body.password, 12),
        role: body.role,
        ...(clientId ? { clientLinks: { create: { tenantId: request.user!.tenantId, clientId, role: body.role } } } : {})
      }
    });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'user.create', entity: 'user', entityId: user.id });
    return { user: publicUser(user) };
  });

  app.patch('/users/:id', { preHandler: requireRoles(INTERNAL_ROLES) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional(),
      role: z.nativeEnum(Role).optional(),
      clientId: z.string().nullable().optional()
    }).parse(request.body);
    const existing = await prisma.user.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Usuario nao encontrado.' });

    const nextRole = body.role ?? existing.role;
    if (!canManageUser(request.user!.role, existing.role, nextRole)) {
      return reply.code(403).send({ message: 'Permissao insuficiente para alterar este usuario.' });
    }

    const requestedClientId = body.clientId === undefined ? existing.clientId : body.clientId;
    const clientId = await resolveClientIdForRole(request.user!.tenantId, nextRole, requestedClientId);
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          email: body.email?.toLowerCase(),
          role: nextRole,
          clientId
        }
      });
      if (!isClientScopedRole(nextRole) || !clientId) {
        await tx.clientUser.deleteMany({ where: { tenantId: request.user!.tenantId, userId: existing.id } });
      } else {
        await tx.clientUser.deleteMany({ where: { tenantId: request.user!.tenantId, userId: existing.id, NOT: { clientId } } });
        await tx.clientUser.upsert({
          where: { clientId_userId: { clientId, userId: existing.id } },
          create: { tenantId: request.user!.tenantId, clientId, userId: existing.id, role: nextRole },
          update: { role: nextRole }
        });
      }
      return updated;
    });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'user.update', entity: 'user', entityId: user.id });
    return { user: publicUser(user) };
  });

  app.patch('/users/:id/status', { preHandler: requireRoles(ADMIN_ROLES) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ status: z.nativeEnum(UserStatus) }).parse(request.body);
    const existing = await prisma.user.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Usuario nao encontrado.' });
    if (params.id === request.user!.sub && body.status !== UserStatus.ACTIVE) return reply.code(400).send({ message: 'Nao e permitido desativar o proprio usuario.' });
    if (!canManageUser(request.user!.role, existing.role)) return reply.code(403).send({ message: 'Permissao insuficiente para alterar status.' });
    const user = await prisma.user.update({ where: { id: existing.id }, data: { status: body.status } });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'user.status', entity: 'user', entityId: user.id, metadata: { status: body.status } });
    return { user: publicUser(user) };
  });

  app.post('/users/:id/reset-password', { preHandler: requireRoles(ADMIN_ROLES) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.user.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Usuario nao encontrado.' });
    if (!canManageUser(request.user!.role, existing.role)) return reply.code(403).send({ message: 'Permissao insuficiente para redefinir senha.' });
    const temporaryPassword = randomToken(6);
    const user = await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: await bcrypt.hash(temporaryPassword, 12) } });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'user.reset-password', entity: 'user', entityId: user.id });
    return { user: publicUser(user), temporaryPassword };
  });
}
