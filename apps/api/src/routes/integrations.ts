import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { IntegrationStatus, Platform } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { requireRoles } from '../middleware/auth.js';
import { MANAGER_ROLES } from '../services/accessControl.js';
import { isFeatureEnabled, requireFeature } from '../services/features.js';
import { logAudit } from '../services/audit.js';
import { exchangeGoogleCode, googleAuthUrl, listGoogleAccessibleCustomers } from '../services/googleAds.js';
import { exchangeMetaCode, listMetaAdAccounts, metaAuthUrl } from '../services/metaAds.js';
import { syncClientMetrics } from '../services/sync.js';
import { decryptSecret, encryptSecret } from '../utils/crypto.js';

type OAuthState = {
  tenantId: string;
  clientId: string;
  userId: string;
  platform: Platform;
};

function signState(state: OAuthState) {
  return jwt.sign(state, env.JWT_SECRET, { expiresIn: '20m' });
}

function verifyState(value: string) {
  return jwt.verify(value, env.JWT_SECRET) as OAuthState;
}

function publicIntegration(item: any) {
  return { ...item, accessTokenEncrypted: undefined, refreshTokenEncrypted: undefined };
}

async function assertClient(tenantId: string, clientId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, tenantId } });
  if (!client) throw Object.assign(new Error('Cliente nao encontrado.'), { statusCode: 404 });
  return client;
}

export async function integrationRoutes(app: FastifyInstance) {
  app.get('/integrations', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request) => {
    const query = z.object({ clientId: z.string().optional(), platform: z.nativeEnum(Platform).optional() }).parse(request.query);
    if (query.clientId) await assertClient(request.user!.tenantId, query.clientId);
    const integrations = await prisma.integration.findMany({
      where: {
        tenantId: request.user!.tenantId,
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.platform ? { platform: query.platform } : {})
      },
      include: { client: true },
      orderBy: { updatedAt: 'desc' }
    });
    return { integrations: integrations.map(publicIntegration) };
  });

  app.post('/integrations/token', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request) => {
    const body = z.object({
      clientId: z.string(),
      platform: z.nativeEnum(Platform),
      providerAccountId: z.string().optional(),
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      scopes: z.string().optional()
    }).parse(request.body);
    await assertClient(request.user!.tenantId, body.clientId);
    const integration = await prisma.integration.create({
      data: {
        tenantId: request.user!.tenantId,
        clientId: body.clientId,
        platform: body.platform,
        providerAccountId: body.providerAccountId,
        accessTokenEncrypted: encryptSecret(body.accessToken),
        refreshTokenEncrypted: encryptSecret(body.refreshToken),
        scopes: body.scopes,
        status: IntegrationStatus.CONNECTED
      }
    });
    await logAudit({ tenantId: request.user!.tenantId, userId: request.user!.sub, action: 'integration.token', entity: 'integration', entityId: integration.id });
    return { integration: publicIntegration(integration) };
  });

  app.get('/integrations/meta/auth-url', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request) => {
    const query = z.object({ clientId: z.string() }).parse(request.query);
    await assertClient(request.user!.tenantId, query.clientId);
    return { url: metaAuthUrl(signState({ tenantId: request.user!.tenantId, clientId: query.clientId, userId: request.user!.sub, platform: Platform.META })) };
  });

  app.get('/integrations/meta/callback', async (request, reply) => {
    const query = z.object({ code: z.string(), state: z.string() }).parse(request.query);
    const state = verifyState(query.state);
    if (!(await isFeatureEnabled(state.tenantId, 'integrations'))) return reply.code(403).send({ message: 'Integracoes desativadas para esta empresa.' });
    await assertClient(state.tenantId, state.clientId);
    const token = await exchangeMetaCode(query.code);
    const integration = await prisma.integration.create({
      data: {
        tenantId: state.tenantId,
        clientId: state.clientId,
        platform: Platform.META,
        accessTokenEncrypted: encryptSecret(token.access_token),
        tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
        scopes: 'ads_read,business_management',
        status: IntegrationStatus.CONNECTED
      }
    });
    await logAudit({ tenantId: state.tenantId, userId: state.userId, action: 'integration.meta.callback', entity: 'integration', entityId: integration.id });
    return reply.type('text/html').send('<html><body><h1>Meta Ads conectada</h1><p>Voce pode fechar esta janela.</p></body></html>');
  });

  app.get('/integrations/meta/accounts', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request, reply) => {
    const query = z.object({ integrationId: z.string() }).parse(request.query);
    const integration = await prisma.integration.findFirst({ where: { id: query.integrationId, tenantId: request.user!.tenantId, platform: Platform.META } });
    if (!integration) return reply.code(404).send({ message: 'Integracao Meta nao encontrada.' });
    const token = decryptSecret(integration.accessTokenEncrypted);
    if (!token) return reply.code(400).send({ message: 'Token Meta ausente.' });
    return { accounts: await listMetaAdAccounts(token) };
  });

  app.post('/integrations/meta/connect-account', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request) => {
    const body = z.object({
      clientId: z.string(),
      externalAccountId: z.string(),
      accountName: z.string(),
      currency: z.string().optional(),
      timezone: z.string().optional()
    }).parse(request.body);
    await assertClient(request.user!.tenantId, body.clientId);
    const account = await prisma.adAccount.upsert({
      where: { platform_externalAccountId_clientId: { platform: Platform.META, externalAccountId: body.externalAccountId.replace(/^act_/, ''), clientId: body.clientId } },
      create: { tenantId: request.user!.tenantId, clientId: body.clientId, platform: Platform.META, externalAccountId: body.externalAccountId.replace(/^act_/, ''), accountName: body.accountName, currency: body.currency || 'BRL', timezone: body.timezone, status: 'active' },
      update: { accountName: body.accountName, currency: body.currency || 'BRL', timezone: body.timezone, status: 'active' }
    });
    return { account };
  });

  app.post('/integrations/meta/disconnect', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request, reply) => {
    const body = z.object({ integrationId: z.string() }).parse(request.body);
    const integration = await prisma.integration.findFirst({ where: { id: body.integrationId, tenantId: request.user!.tenantId, platform: Platform.META } });
    if (!integration) return reply.code(404).send({ message: 'Integracao nao encontrada.' });
    const updated = await prisma.integration.update({ where: { id: integration.id }, data: { status: IntegrationStatus.DISCONNECTED } });
    return { integration: publicIntegration(updated) };
  });

  app.post('/integrations/meta/sync/:clientId', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request) => {
    const params = z.object({ clientId: z.string() }).parse(request.params);
    const body = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(request.body ?? {});
    await assertClient(request.user!.tenantId, params.clientId);
    const to = body.to || new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);
    return syncClientMetrics({ tenantId: request.user!.tenantId, clientId: params.clientId, platform: Platform.META, from: body.from || fromDate.toISOString().slice(0, 10), to, requestedBy: request.user!.sub });
  });

  app.get('/integrations/google/auth-url', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request) => {
    const query = z.object({ clientId: z.string() }).parse(request.query);
    await assertClient(request.user!.tenantId, query.clientId);
    return { url: googleAuthUrl(signState({ tenantId: request.user!.tenantId, clientId: query.clientId, userId: request.user!.sub, platform: Platform.GOOGLE })) };
  });

  app.get('/integrations/google/callback', async (request, reply) => {
    const query = z.object({ code: z.string(), state: z.string() }).parse(request.query);
    const state = verifyState(query.state);
    if (!(await isFeatureEnabled(state.tenantId, 'integrations'))) return reply.code(403).send({ message: 'Integracoes desativadas para esta empresa.' });
    await assertClient(state.tenantId, state.clientId);
    const token = await exchangeGoogleCode(query.code);
    const integration = await prisma.integration.create({
      data: {
        tenantId: state.tenantId,
        clientId: state.clientId,
        platform: Platform.GOOGLE,
        accessTokenEncrypted: encryptSecret(token.access_token),
        refreshTokenEncrypted: encryptSecret(token.refresh_token),
        tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
        scopes: token.scope,
        status: IntegrationStatus.CONNECTED
      }
    });
    await logAudit({ tenantId: state.tenantId, userId: state.userId, action: 'integration.google.callback', entity: 'integration', entityId: integration.id });
    return reply.type('text/html').send('<html><body><h1>Google Ads conectado</h1><p>Voce pode fechar esta janela.</p></body></html>');
  });

  app.get('/integrations/google/accounts', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request, reply) => {
    const query = z.object({ integrationId: z.string() }).parse(request.query);
    const integration = await prisma.integration.findFirst({ where: { id: query.integrationId, tenantId: request.user!.tenantId, platform: Platform.GOOGLE } });
    if (!integration) return reply.code(404).send({ message: 'Integracao Google nao encontrada.' });
    const refreshToken = decryptSecret(integration.refreshTokenEncrypted);
    if (!refreshToken) return reply.code(400).send({ message: 'Refresh token Google ausente.' });
    return { accounts: await listGoogleAccessibleCustomers(refreshToken) };
  });

  app.post('/integrations/google/connect-account', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request) => {
    const body = z.object({
      clientId: z.string(),
      externalAccountId: z.string(),
      accountName: z.string(),
      currency: z.string().optional(),
      timezone: z.string().optional()
    }).parse(request.body);
    await assertClient(request.user!.tenantId, body.clientId);
    const account = await prisma.adAccount.upsert({
      where: { platform_externalAccountId_clientId: { platform: Platform.GOOGLE, externalAccountId: body.externalAccountId.replace(/-/g, ''), clientId: body.clientId } },
      create: { tenantId: request.user!.tenantId, clientId: body.clientId, platform: Platform.GOOGLE, externalAccountId: body.externalAccountId.replace(/-/g, ''), accountName: body.accountName, currency: body.currency || 'BRL', timezone: body.timezone, status: 'active' },
      update: { accountName: body.accountName, currency: body.currency || 'BRL', timezone: body.timezone, status: 'active' }
    });
    return { account };
  });

  app.post('/integrations/google/disconnect', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request, reply) => {
    const body = z.object({ integrationId: z.string() }).parse(request.body);
    const integration = await prisma.integration.findFirst({ where: { id: body.integrationId, tenantId: request.user!.tenantId, platform: Platform.GOOGLE } });
    if (!integration) return reply.code(404).send({ message: 'Integracao nao encontrada.' });
    const updated = await prisma.integration.update({ where: { id: integration.id }, data: { status: IntegrationStatus.DISCONNECTED } });
    return { integration: publicIntegration(updated) };
  });

  app.post('/integrations/google/sync/:clientId', { preHandler: [requireRoles(MANAGER_ROLES), requireFeature('integrations')] }, async (request) => {
    const params = z.object({ clientId: z.string() }).parse(request.params);
    const body = z.object({ from: z.string().optional(), to: z.string().optional() }).parse(request.body ?? {});
    await assertClient(request.user!.tenantId, params.clientId);
    const to = body.to || new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 7);
    return syncClientMetrics({ tenantId: request.user!.tenantId, clientId: params.clientId, platform: Platform.GOOGLE, from: body.from || fromDate.toISOString().slice(0, 10), to, requestedBy: request.user!.sub });
  });
}
