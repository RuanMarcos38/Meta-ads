import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { Role, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { slugify } from '../utils/slug.js';

function publicUser(user: { id: string; name: string; email: string; role: Role; tenantId: string; clientId: string | null; status?: UserStatus }) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    clientId: user.clientId,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status
  };
}

function tokenFor(user: { id: string; tenantId: string; clientId: string | null; role: Role; email: string; name: string }) {
  return signToken({
    sub: user.id,
    tenantId: user.tenantId,
    clientId: user.clientId,
    role: user.role,
    email: user.email,
    name: user.name
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/bootstrap', async (request, reply) => {
    const body = z.object({
      tenantName: z.string().min(2),
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6)
    }).parse(request.body);

    const existingAdmin = await prisma.user.count({ where: { role: Role.ADMIN } });
    if (existingAdmin > 0) return reply.code(409).send({ message: 'Bootstrap bloqueado: ja existe administrador cadastrado.' });

    const passwordHash = await bcrypt.hash(body.password, 12);
    const tenant = await prisma.tenant.create({ data: { name: body.tenantName, slug: slugify(body.tenantName) } });
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash,
        role: Role.ADMIN
      }
    });
    await logAudit({ tenantId: tenant.id, userId: user.id, action: 'auth.bootstrap', entity: 'tenant', entityId: tenant.id });
    return { token: tokenFor(user), user: publicUser(user), tenant };
  });

  app.post('/auth/login', async (request, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() }, include: { tenant: true, client: true } });
    if (!user || user.status !== UserStatus.ACTIVE || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ message: 'E-mail ou senha invalidos.' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await logAudit({ tenantId: user.tenantId, userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id });
    return { token: tokenFor(user), user: { ...publicUser(user), tenant: user.tenant.name, client: user.client?.name ?? null } };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user!.sub },
      select: {
        id: true,
        tenantId: true,
        clientId: true,
        name: true,
        email: true,
        role: true,
        status: true,
        tenant: { select: { name: true } },
        client: { select: { name: true } }
      }
    });
    return { user };
  });

  app.get('/me', { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user!.sub },
      select: { id: true, tenantId: true, clientId: true, name: true, email: true, role: true, status: true }
    });
    return { user };
  });

  app.post('/auth/logout', { preHandler: requireAuth }, async (request) => {
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'auth.logout', entity: 'user', entityId: request.user!.sub });
    return { ok: true };
  });

  app.post('/auth/forgot-password', async (request) => {
    const body = z.object({ email: z.string().email() }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) return { message: 'Se o e-mail existir, enviaremos instrucoes de recuperacao.' };
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
    await prisma.passwordResetToken.create({
      data: { tenantId: user.tenantId, userId: user.id, tokenHash: sha256(token), expiresAt }
    });
    return {
      message: 'Token de recuperacao gerado.',
      ...(env.NODE_ENV === 'production' ? {} : { resetToken: token })
    };
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const body = z.object({ token: z.string().min(10), password: z.string().min(6) }).parse(request.body);
    const record = await prisma.passwordResetToken.findFirst({
      where: { tokenHash: sha256(body.token), usedAt: null, expiresAt: { gt: new Date() } }
    });
    if (!record) return reply.code(400).send({ message: 'Token de recuperacao invalido ou expirado.' });
    const passwordHash = await bcrypt.hash(body.password, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })
    ]);
    await logAudit({ tenantId: record.tenantId, userId: record.userId, action: 'auth.reset-password', entity: 'user', entityId: record.userId });
    return { ok: true };
  });

  app.patch('/auth/change-password', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.user!.sub } });
    if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      return reply.code(401).send({ message: 'Senha atual invalida.' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, 12) } });
    await logAudit({ tenantId: user.tenantId, userId: user.id, action: 'auth.change-password', entity: 'user', entityId: user.id });
    return { ok: true };
  });
}
