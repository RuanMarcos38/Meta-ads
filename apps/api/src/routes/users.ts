import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { Role, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireRoles } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { randomToken } from '../utils/crypto.js';

function publicUser(user: any) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request) => {
    const users = await prisma.user.findMany({
      where: { tenantId: request.user!.tenantId },
      select: { id: true, name: true, email: true, role: true, status: true, clientId: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    return { users };
  });

  app.post('/users', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
      role: z.nativeEnum(Role),
      clientId: z.string().optional()
    }).parse(request.body);
    if (request.user!.role === Role.MANAGER && body.role === Role.ADMIN) {
      return reply.code(403).send({ message: 'Manager nao pode criar administrador.' });
    }
    if (body.role === Role.CLIENT && !body.clientId) return reply.code(400).send({ message: 'clientId e obrigatorio para usuario CLIENT.' });
    if (body.clientId) {
      const client = await prisma.client.findFirst({ where: { id: body.clientId, tenantId: request.user!.tenantId } });
      if (!client) return reply.code(404).send({ message: 'Cliente nao encontrado.' });
    }
    const user = await prisma.user.create({
      data: {
        tenantId: request.user!.tenantId,
        clientId: body.role === Role.CLIENT ? body.clientId : null,
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: await bcrypt.hash(body.password, 12),
        role: body.role,
        ...(body.clientId ? { clientLinks: { create: { tenantId: request.user!.tenantId, clientId: body.clientId, role: body.role } } } : {})
      }
    });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'user.create', entity: 'user', entityId: user.id });
    return { user: publicUser(user) };
  });

  app.patch('/users/:id', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ name: z.string().min(2).optional(), email: z.string().email().optional(), role: z.nativeEnum(Role).optional(), clientId: z.string().nullable().optional() }).parse(request.body);
    const existing = await prisma.user.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Usuario nao encontrado.' });
    if (request.user!.role === Role.MANAGER && body.role === Role.ADMIN) return reply.code(403).send({ message: 'Manager nao pode promover administrador.' });
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        email: body.email?.toLowerCase(),
        role: body.role,
        clientId: body.role === Role.CLIENT ? body.clientId ?? existing.clientId : body.clientId
      }
    });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'user.update', entity: 'user', entityId: user.id });
    return { user: publicUser(user) };
  });

  app.patch('/users/:id/status', { preHandler: requireRoles([Role.ADMIN]) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ status: z.nativeEnum(UserStatus) }).parse(request.body);
    const existing = await prisma.user.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Usuario nao encontrado.' });
    const user = await prisma.user.update({ where: { id: existing.id }, data: { status: body.status } });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'user.status', entity: 'user', entityId: user.id, metadata: { status: body.status } });
    return { user: publicUser(user) };
  });

  app.post('/users/:id/reset-password', { preHandler: requireRoles([Role.ADMIN]) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.user.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Usuario nao encontrado.' });
    const temporaryPassword = randomToken(6);
    const user = await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: await bcrypt.hash(temporaryPassword, 12) } });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'user.reset-password', entity: 'user', entityId: user.id });
    return { user: publicUser(user), temporaryPassword };
  });
}
