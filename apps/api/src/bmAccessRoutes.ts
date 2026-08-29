import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from './config/env.js';
import { prisma } from './shared/prisma.js';
import { fail, ok } from './shared/response.js';
import { hashPassword, verifyPassword } from './shared/password.js';
import { requireAuth, type AuthUser } from './shared/auth.js';

const tenantRoles = new Set(['CLIENT', 'MANAGER']);

function configurationFailure(reply: any) {
  return reply.code(503).send(fail(
    'CONFIGURATION_ERROR',
    'A API está online, mas existem variáveis inválidas no EasyPanel.',
    { issues: env.configurationErrors },
  ));
}

function normalizeBusinessId(value?: string | null) {
  return String(value || '').trim();
}

export async function registerBmAccessRoutes(app: FastifyInstance) {
  app.post('/auth/login-bm', async (req, reply) => {
    if (env.configurationErrors.length) return configurationFailure(reply);

    const body = z.object({
      email: z.string().email(),
      password: z.string().min(1),
      businessId: z.string().trim().max(100).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Dados de acesso inválidos.'));

    const email = body.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      include: { client: true },
    });
    if (!user || !user.isActive) {
      return reply.code(401).send(fail('INVALID_CREDENTIALS', 'E-mail, senha ou BM inválidos.'));
    }

    const password = await verifyPassword(body.data.password, user.passwordHash);
    if (!password.valid) {
      return reply.code(401).send(fail('INVALID_CREDENTIALS', 'E-mail, senha ou BM inválidos.'));
    }

    const requestedBusinessId = normalizeBusinessId(body.data.businessId);
    const isTenant = tenantRoles.has(user.role);
    const linkedBusinessId = normalizeBusinessId(user.businessId || user.client?.metaBusinessId);

    if (isTenant) {
      if (!requestedBusinessId) {
        return reply.code(400).send(fail('BM_REQUIRED', 'Informe o ID da Business Manager vinculada ao seu acesso.'));
      }
      if (!user.clientId || !linkedBusinessId) {
        return reply.code(403).send(fail('BM_NOT_LINKED', 'Seu acesso ainda não possui uma Business Manager vinculada.'));
      }
      if (requestedBusinessId !== linkedBusinessId) {
        return reply.code(401).send(fail('INVALID_BM', 'A Business Manager informada não pertence a este acesso.'));
      }

      const authorizedAccounts = await prisma.metaAdAccount.count({
        where: {
          organizationId: user.organizationId!,
          clientId: user.clientId,
          businessId: linkedBusinessId,
          isActive: true,
          isAssigned: true,
        },
      });
      if (!authorizedAccounts) {
        return reply.code(403).send(fail('BM_WITHOUT_ACCOUNTS', 'Esta BM ainda não possui contas Meta autorizadas no sistema.'));
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        ...(password.upgradedHash ? { passwordHash: password.upgradedHash } : {}),
        ...(isTenant && linkedBusinessId && user.businessId !== linkedBusinessId ? { businessId: linkedBusinessId } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        action: 'LOGIN_BM',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        metadataJson: {
          businessId: isTenant ? linkedBusinessId : requestedBusinessId || null,
          clientId: user.clientId || null,
          legacyPasswordHashUpgraded: Boolean(password.upgradedHash),
        },
      },
    });

    const payload: AuthUser = {
      id: user.id,
      role: user.role,
      organizationId: user.organizationId ?? undefined,
      clientId: user.clientId ?? undefined,
      businessId: isTenant ? linkedBusinessId : undefined,
    };
    const token = app.jwt.sign(payload, { expiresIn: env.jwtExpiresIn });
    const refresh = app.jwt.sign(payload, {
      expiresIn: env.jwtRefreshExpiresIn,
      key: env.jwtRefreshSecret,
    } as any);

    return ok({
      token,
      refresh,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        clientId: user.clientId,
        businessId: isTenant ? linkedBusinessId : null,
        businessName: isTenant ? user.client?.metaBusinessName || null : null,
        mustChangePassword: user.mustChangePassword,
      },
    });
  });

  app.post('/auth/refresh-bm', async (req, reply) => {
    if (env.configurationErrors.length) return configurationFailure(reply);

    const body = z.object({ refresh: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Refresh token ausente.'));

    try {
      const payload = app.jwt.verify(body.data.refresh, { key: env.jwtRefreshSecret } as any) as AuthUser;
      const user = await prisma.user.findUnique({ where: { id: payload.id }, include: { client: true } });
      if (!user || !user.isActive) throw new Error('Usuário inválido');

      const isTenant = tenantRoles.has(user.role);
      const linkedBusinessId = normalizeBusinessId(user.businessId || user.client?.metaBusinessId);
      if (isTenant && (!user.clientId || !linkedBusinessId)) throw new Error('Escopo BM inválido');

      const nextPayload: AuthUser = {
        id: user.id,
        role: user.role,
        organizationId: user.organizationId ?? undefined,
        clientId: user.clientId ?? undefined,
        businessId: isTenant ? linkedBusinessId : undefined,
      };
      const token = app.jwt.sign(nextPayload, { expiresIn: env.jwtExpiresIn });
      return ok({ token });
    } catch {
      return reply.code(401).send(fail('INVALID_REFRESH_TOKEN', 'Sessão expirada. Faça login novamente.'));
    }
  });

  app.patch('/clients/:id/business-access', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    const admin = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({
      businessId: z.string().trim().min(2).max(100),
      businessName: z.string().trim().min(2).max(160),
      adminEmail: z.string().email(),
    }).safeParse(req.body);
    if (!params.success || !body.success) {
      return reply.code(400).send(fail('VALIDATION', 'Dados da Business Manager inválidos.'));
    }

    const client = await prisma.client.findFirst({
      where: { id: params.data.id, organizationId: admin.organizationId! },
      select: { id: true, name: true },
    });
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada.'));

    const businessId = normalizeBusinessId(body.data.businessId);
    const businessName = body.data.businessName.trim();
    const adminEmail = body.data.adminEmail.trim().toLowerCase();

    const result = await prisma.$transaction(async (tx) => {
      const updatedClient = await tx.client.update({
        where: { id: client.id },
        data: {
          metaBusinessId: businessId,
          metaBusinessName: businessName,
          metaAdminEmail: adminEmail,
        },
      });

      const users = await tx.user.updateMany({
        where: {
          organizationId: admin.organizationId!,
          clientId: client.id,
          role: { in: ['CLIENT', 'MANAGER'] },
        },
        data: { businessId },
      });

      const accounts = await tx.metaAdAccount.updateMany({
        where: {
          organizationId: admin.organizationId!,
          clientId: client.id,
          isAssigned: true,
        },
        data: { businessId, businessName },
      });

      await tx.auditLog.create({
        data: {
          organizationId: admin.organizationId,
          userId: admin.id,
          action: 'LINK_CLIENT_BUSINESS_MANAGER',
          entity: 'Client',
          entityId: client.id,
          metadataJson: {
            businessId,
            businessName,
            adminEmail,
            usersUpdated: users.count,
            assignedAccountsUpdated: accounts.count,
          },
        },
      });

      return updatedClient;
    });

    return ok(result, 'Business Manager vinculada à empresa. Usuários e contas autorizadas foram atualizados.');
  });

  app.patch('/meta/client-accounts/:id/business-assignment', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    const admin = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({ isAssigned: z.boolean() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(fail('VALIDATION', 'Vinculação de conta inválida.'));

    const account = await prisma.metaAdAccount.findFirst({
      where: { id: params.data.id, organizationId: admin.organizationId! },
      include: { client: true },
    });
    if (!account) return reply.code(404).send(fail('META_ACCOUNT_NOT_FOUND', 'Conta Meta não encontrada.'));
    if (body.data.isAssigned && !account.isActive) {
      return reply.code(409).send(fail('META_ACCOUNT_DISCONNECTED', 'Reconecte a Meta antes de vincular esta conta.'));
    }
    if (body.data.isAssigned && (!account.client.metaBusinessId || !account.client.metaBusinessName)) {
      return reply.code(409).send(fail('BM_REQUIRED', 'Vincule primeiro a Business Manager da empresa.'));
    }

    const updated = await prisma.metaAdAccount.update({
      where: { id: account.id },
      data: body.data.isAssigned
        ? {
            isAssigned: true,
            businessId: account.client.metaBusinessId,
            businessName: account.client.metaBusinessName,
          }
        : { isAssigned: false },
      select: {
        id: true,
        clientId: true,
        accountId: true,
        name: true,
        currency: true,
        businessId: true,
        businessName: true,
        isActive: true,
        isAssigned: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: admin.organizationId,
        userId: admin.id,
        action: body.data.isAssigned ? 'ASSIGN_META_ACCOUNT_TO_BM' : 'UNASSIGN_META_ACCOUNT_FROM_BM',
        entity: 'MetaAdAccount',
        entityId: updated.id,
        metadataJson: {
          clientId: updated.clientId,
          accountId: updated.accountId,
          businessId: updated.businessId,
        },
      },
    });

    return ok(updated, body.data.isAssigned
      ? 'Conta Meta vinculada à BM desta empresa.'
      : 'Conta Meta removida do dashboard desta empresa.');
  });

  app.get('/access/users-bm', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req) => {
    const admin = req.user as AuthUser;
    const users = await prisma.user.findMany({
      where: { organizationId: admin.organizationId!, role: { in: ['CLIENT', 'MANAGER'] } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        clientId: true,
        businessId: true,
        isActive: true,
        lastLoginAt: true,
        client: {
          select: {
            name: true,
            metaBusinessId: true,
            metaBusinessName: true,
            metaAdminEmail: true,
          },
        },
      },
      orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
    });
    return ok(users);
  });

  app.post('/access/users-bm', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']) }, async (req, reply) => {
    const admin = req.user as AuthUser;
    const body = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().email(),
      password: z.string().min(12).max(200),
      clientId: z.string().uuid(),
      role: z.enum(['CLIENT', 'MANAGER']).default('CLIENT'),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Dados do usuário inválidos.'));

    const client = await prisma.client.findFirst({
      where: { id: body.data.clientId, organizationId: admin.organizationId! },
      select: {
        id: true,
        name: true,
        metaBusinessId: true,
        metaBusinessName: true,
      },
    });
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada para vincular o usuário.'));
    if (!client.metaBusinessId) {
      return reply.code(409).send(fail('BM_REQUIRED', 'Vincule a Business Manager da empresa antes de criar usuários.'));
    }

    const email = body.data.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send(fail('EMAIL_IN_USE', 'Já existe um usuário com este e-mail.'));

    const passwordHash = await hashPassword(body.data.password);
    const created = await prisma.user.create({
      data: {
        name: body.data.name,
        email,
        passwordHash,
        role: body.data.role,
        organizationId: admin.organizationId!,
        clientId: client.id,
        businessId: client.metaBusinessId,
        isActive: true,
        mustChangePassword: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        clientId: true,
        businessId: true,
        isActive: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: admin.organizationId,
        userId: admin.id,
        action: 'CREATE_BM_TENANT_USER',
        entity: 'User',
        entityId: created.id,
        metadataJson: {
          clientId: created.clientId,
          businessId: created.businessId,
          role: created.role,
        },
      },
    });

    return ok(created, 'Usuário criado e vinculado exclusivamente à empresa e BM selecionadas.');
  });
}
