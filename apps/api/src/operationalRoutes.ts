import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from './config/env.js';
import { MetaAdsService } from './modules/meta/MetaAdsService.js';
import { prisma } from './shared/prisma.js';
import { decrypt } from './shared/crypto.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

const META_MANAGEMENT_SCOPES = ['ads_read', 'ads_management', 'business_management'] as const;
const CAMPAIGN_OBJECTIVES = [
  'OUTCOME_AWARENESS',
  'OUTCOME_TRAFFIC',
  'OUTCOME_ENGAGEMENT',
  'OUTCOME_LEADS',
  'OUTCOME_APP_PROMOTION',
  'OUTCOME_SALES',
] as const;
const SPECIAL_AD_CATEGORIES = ['HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS'] as const;

function metaConfigurationReady() {
  return Boolean(env.meta.appId && env.meta.appSecret && env.meta.redirectUri);
}

function restrictedAccessWithoutClient(user: AuthUser, clientId?: string) {
  return (user.role === 'CLIENT' || user.role === 'MANAGER') && !clientId;
}

export async function registerOperationalRoutes(app: FastifyInstance) {
  app.get('/meta/oauth/start-management', {
    preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']),
  }, async (req, reply) => {
    if (!metaConfigurationReady()) {
      return reply.code(503).send(fail(
        'META_CONFIGURATION_ERROR',
        'Configure META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no EasyPanel.',
      ));
    }

    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid() }).safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send(fail('CLIENT_REQUIRED', 'Informe um cliente válido para conectar à Meta.'));
    }

    const client = await prisma.client.findFirst({
      where: { id: query.data.clientId, organizationId: user.organizationId! },
      select: { id: true },
    });
    if (!client) return reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Cliente não encontrado para este acesso.'));

    const state = app.jwt.sign({
      type: 'meta_oauth',
      userId: user.id,
      organizationId: user.organizationId,
      clientId: client.id,
    }, { expiresIn: '10m' });

    const authUrl = new URL(`https://www.facebook.com/${env.meta.apiVersion}/dialog/oauth`);
    authUrl.searchParams.set('client_id', env.meta.appId);
    authUrl.searchParams.set('redirect_uri', env.meta.redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', META_MANAGEMENT_SCOPES.join(','));

    return ok({ authUrl: authUrl.toString(), scopes: META_MANAGEMENT_SCOPES });
  });

  app.get('/meta/status', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({ clientId: z.string().uuid().optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtro de cliente inválido.'));

    const clientId = scopeClient(user, query.data.clientId);
    if (restrictedAccessWithoutClient(user, clientId)) {
      return reply.code(403).send(fail('CLIENT_SCOPE_REQUIRED', 'Este usuário não possui cliente associado.'));
    }

    const where = {
      organizationId: user.organizationId!,
      ...(clientId ? { clientId } : {}),
    };

    const [connections, accounts, jobs] = await Promise.all([
      prisma.metaConnection.findMany({
        where: { ...where, status: 'active' },
        select: {
          clientId: true,
          tokenExpiresAt: true,
          scopes: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.metaAdAccount.findMany({
        where: { ...where, isActive: true },
        select: {
          id: true,
          clientId: true,
          accountId: true,
          name: true,
          currency: true,
          timezone: true,
          accountStatus: true,
          isActive: true,
          updatedAt: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.syncJob.findMany({
        where,
        select: {
          clientId: true,
          type: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          recordsProcessed: true,
        },
        orderBy: { startedAt: 'desc' },
        take: 200,
      }),
    ]);

    const clientIds = new Set<string>();
    for (const connection of connections) if (connection.clientId) clientIds.add(connection.clientId);
    for (const account of accounts) clientIds.add(account.clientId);
    for (const job of jobs) if (job.clientId) clientIds.add(job.clientId);
    if (clientId) clientIds.add(clientId);

    const clients = Array.from(clientIds).map((id) => {
      const connection = connections.find((item) => item.clientId === id);
      const clientAccounts = accounts.filter((item) => item.clientId === id);
      const lastSync = jobs.find((item) => item.clientId === id);
      return {
        clientId: id,
        connected: Boolean(connection),
        accountCount: clientAccounts.length,
        tokenExpiresAt: connection?.tokenExpiresAt ?? null,
        connectedAt: connection?.updatedAt ?? null,
        storedScopes: connection?.scopes ?? '',
        lastSync: lastSync ?? null,
      };
    });

    return ok({
      configured: metaConfigurationReady(),
      requiredScopes: META_MANAGEMENT_SCOPES,
      clients,
      accounts,
    });
  });

  app.post('/campaigns', {
    preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER']),
  }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({
      adAccountId: z.string().uuid(),
      name: z.string().trim().min(3).max(200),
      objective: z.enum(CAMPAIGN_OBJECTIVES),
      dailyBudget: z.coerce.number().positive().max(10_000_000).optional(),
      specialAdCategories: z.array(z.enum(SPECIAL_AD_CATEGORIES)).max(4).optional(),
    }).safeParse(req.body);

    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Dados da campanha inválidos.'));

    const restrictedClientId = scopeClient(user);
    if (restrictedAccessWithoutClient(user, restrictedClientId)) {
      return reply.code(403).send(fail('CLIENT_SCOPE_REQUIRED', 'Este usuário não possui cliente associado.'));
    }

    const account = await prisma.metaAdAccount.findFirst({
      where: {
        id: body.data.adAccountId,
        organizationId: user.organizationId!,
        isActive: true,
        ...(restrictedClientId ? { clientId: restrictedClientId } : {}),
      },
      include: { connection: true },
    });

    if (!account || account.connection.status !== 'active') {
      return reply.code(404).send(fail('META_ACCOUNT_NOT_FOUND', 'Conta de anúncio ativa não encontrada para este acesso.'));
    }

    try {
      const token = decrypt(account.connection.accessTokenEncrypted);
      const meta = new MetaAdsService(token);
      const metaAccountId = account.accountId.startsWith('act_') ? account.accountId : `act_${account.accountId}`;
      const created = await meta.createCampaign(metaAccountId, {
        name: body.data.name,
        objective: body.data.objective,
        dailyBudgetCents: body.data.dailyBudget ? Math.round(body.data.dailyBudget * 100) : undefined,
        specialAdCategories: body.data.specialAdCategories,
      });

      const campaign = await prisma.campaign.upsert({
        where: {
          adAccountId_metaCampaignId: {
            adAccountId: account.id,
            metaCampaignId: created.id,
          },
        },
        update: {
          name: body.data.name,
          objective: body.data.objective,
          status: 'PAUSED',
          effectiveStatus: 'PAUSED',
          buyingType: 'AUCTION',
          dailyBudget: body.data.dailyBudget ?? null,
        },
        create: {
          organizationId: user.organizationId!,
          clientId: account.clientId,
          adAccountId: account.id,
          metaCampaignId: created.id,
          name: body.data.name,
          objective: body.data.objective,
          status: 'PAUSED',
          effectiveStatus: 'PAUSED',
          buyingType: 'AUCTION',
          dailyBudget: body.data.dailyBudget ?? null,
        },
      });

      await prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: 'CREATE_META_CAMPAIGN',
          entity: 'Campaign',
          entityId: campaign.id,
          metadataJson: { metaCampaignId: created.id, adAccountId: account.accountId },
        },
      });

      return ok(campaign, 'Campanha criada na Meta em modo pausado.');
    } catch (error: any) {
      return reply.code(502).send(fail(
        'META_CAMPAIGN_CREATE_ERROR',
        'A Meta não aceitou a criação da campanha. Verifique as permissões e os dados informados.',
        { detail: env.isProduction ? undefined : error?.response?.data?.error?.message ?? error?.message },
      ));
    }
  });

  app.post('/campaigns/:id/status', {
    preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER']),
  }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({ status: z.enum(['ACTIVE', 'PAUSED']) }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(fail('VALIDATION', 'Alteração de status inválida.'));

    const restrictedClientId = scopeClient(user);
    if (restrictedAccessWithoutClient(user, restrictedClientId)) {
      return reply.code(403).send(fail('CLIENT_SCOPE_REQUIRED', 'Este usuário não possui cliente associado.'));
    }

    const campaign = await prisma.campaign.findFirst({
      where: {
        id: params.data.id,
        organizationId: user.organizationId!,
        ...(restrictedClientId ? { clientId: restrictedClientId } : {}),
      },
      include: { adAccount: { include: { connection: true } } },
    });

    if (!campaign || campaign.adAccount.connection.status !== 'active') {
      return reply.code(404).send(fail('CAMPAIGN_NOT_FOUND', 'Campanha não encontrada para este acesso.'));
    }

    try {
      const token = decrypt(campaign.adAccount.connection.accessTokenEncrypted);
      const meta = new MetaAdsService(token);
      await meta.updateCampaignStatus(campaign.metaCampaignId, body.data.status);

      const updated = await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: body.data.status, effectiveStatus: body.data.status },
      });

      await prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: 'UPDATE_META_CAMPAIGN_STATUS',
          entity: 'Campaign',
          entityId: campaign.id,
          metadataJson: { status: body.data.status, metaCampaignId: campaign.metaCampaignId },
        },
      });

      return ok(updated, body.data.status === 'ACTIVE' ? 'Campanha ativada.' : 'Campanha pausada.');
    } catch (error: any) {
      return reply.code(502).send(fail(
        'META_CAMPAIGN_STATUS_ERROR',
        'A Meta não aceitou a alteração de status da campanha.',
        { detail: env.isProduction ? undefined : error?.response?.data?.error?.message ?? error?.message },
      ));
    }
  });
}
