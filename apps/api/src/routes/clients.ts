import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { ClientStatus, Role, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRoles, resolveClientScope } from '../middleware/auth.js';
import { logAudit } from '../services/audit.js';
import { slugify } from '../utils/slug.js';

const clientInput = z.object({
  name: z.string().min(2),
  tradeName: z.string().optional(),
  document: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  status: z.nativeEnum(ClientStatus).optional()
});

async function uniqueClientSlug(tenantId: string, name: string, currentId?: string) {
  const base = slugify(name) || 'cliente';
  let slug = base;
  let suffix = 2;
  while (await prisma.client.findFirst({ where: { tenantId, slug, ...(currentId ? { NOT: { id: currentId } } : {}) }, select: { id: true } })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

export async function clientRoutes(app: FastifyInstance) {
  app.get('/clients', { preHandler: requireAuth }, async (request) => {
    if (request.user!.role === Role.CLIENT) {
      const client = await prisma.client.findFirst({ where: { id: request.user!.clientId ?? '', tenantId: request.user!.tenantId } });
      return { clients: client ? [client] : [] };
    }
    const clients = await prisma.client.findMany({
      where: { tenantId: request.user!.tenantId },
      orderBy: { createdAt: 'desc' }
    });
    return { clients };
  });

  app.post('/clients', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request) => {
    const body = clientInput.parse(request.body);
    const client = await prisma.client.create({
      data: {
        tenantId: request.user!.tenantId,
        name: body.name,
        tradeName: body.tradeName,
        slug: await uniqueClientSlug(request.user!.tenantId, body.name),
        document: body.document,
        email: body.email,
        phone: body.phone,
        status: body.status ?? ClientStatus.ACTIVE
      }
    });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'client.create', entity: 'client', entityId: client.id });
    return { client };
  });

  app.get('/clients/:id', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const clientId = await resolveClientScope(request, params.id);
    const client = await prisma.client.findFirst({
      where: { id: clientId, tenantId: request.user!.tenantId },
      include: { users: { select: { id: true, name: true, email: true, role: true, status: true } }, adAccounts: true, integrations: true }
    });
    if (!client) return reply.code(404).send({ message: 'Cliente nao encontrado.' });
    return { client: { ...client, integrations: client.integrations.map((item) => ({ ...item, accessTokenEncrypted: undefined, refreshTokenEncrypted: undefined })) } };
  });

  app.patch('/clients/:id', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = clientInput.partial().parse(request.body);
    const existing = await prisma.client.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Cliente nao encontrado.' });
    const client = await prisma.client.update({
      where: { id: existing.id },
      data: {
        ...body,
        ...(body.name ? { slug: await uniqueClientSlug(request.user!.tenantId, body.name, existing.id) } : {})
      }
    });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'client.update', entity: 'client', entityId: client.id });
    return { client };
  });

  app.delete('/clients/:id', { preHandler: requireRoles([Role.ADMIN]) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = await prisma.client.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!existing) return reply.code(404).send({ message: 'Cliente nao encontrado.' });
    const client = await prisma.client.update({ where: { id: existing.id }, data: { status: ClientStatus.INACTIVE } });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'client.deactivate', entity: 'client', entityId: client.id });
    return { client };
  });

  app.post('/clients/:id/users', { preHandler: requireRoles([Role.ADMIN, Role.MANAGER]) }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(6),
      role: z.enum(['CLIENT', 'MANAGER']).default('CLIENT')
    }).parse(request.body);
    const client = await prisma.client.findFirst({ where: { id: params.id, tenantId: request.user!.tenantId } });
    if (!client) return reply.code(404).send({ message: 'Cliente nao encontrado.' });
    const user = await prisma.user.create({
      data: {
        tenantId: request.user!.tenantId,
        clientId: body.role === 'CLIENT' ? client.id : null,
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: await bcrypt.hash(body.password, 12),
        role: body.role as Role,
        status: UserStatus.ACTIVE,
        clientLinks: { create: { tenantId: request.user!.tenantId, clientId: client.id, role: body.role as Role } }
      }
    });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'user.create-client', entity: 'user', entityId: user.id });
    return { user: { id: user.id, name: user.name, email: user.email, role: user.role, clientId: user.clientId, status: user.status } };
  });
}
