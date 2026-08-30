import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../shared/prisma.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@r2rmarketingdigital.com.br';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';
const suite = integrationEnabled ? describe : describe.skip;

suite('Performance analytics by BM and period', () => {
  let app: FastifyInstance;
  let token = '';
  let clientId = '';

  beforeAll(async () => {
    if (!adminPassword) throw new Error('SEED_ADMIN_PASSWORD é obrigatória para o teste de integração.');
    app = await buildApp();
    await app.ready();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: adminEmail, password: adminPassword },
    });
    expect(login.statusCode).toBe(200);
    token = login.json().data.token;

    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!admin?.organizationId) throw new Error('Administrador CI sem organização.');

    const client = await prisma.client.create({
      data: { organizationId: admin.organizationId, name: 'Performance BM CI' },
    });
    clientId = client.id;

    const connection = await prisma.metaConnection.create({
      data: {
        organizationId: admin.organizationId,
        clientId,
        accessTokenEncrypted: 'ci-token-not-used-by-performance-read',
        status: 'active',
      },
    });

    const account = await prisma.metaAdAccount.create({
      data: {
        organizationId: admin.organizationId,
        clientId,
        connectionId: connection.id,
        accountId: '123456789001',
        name: 'Conta Performance CI',
        currency: 'BRL',
        businessId: 'bm-performance-ci',
        businessName: 'BM Performance CI',
        isActive: true,
        isAssigned: true,
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        organizationId: admin.organizationId,
        clientId,
        adAccountId: account.id,
        metaCampaignId: 'campaign-performance-ci',
        name: 'Campanha Performance CI',
        objective: 'OUTCOME_LEADS',
        status: 'ACTIVE',
      },
    });

    const adSet = await prisma.adSet.create({
      data: {
        campaignId: campaign.id,
        metaAdsetId: 'adset-performance-ci',
        name: 'Conjunto Performance CI',
        status: 'ACTIVE',
      },
    });

    await prisma.ad.create({
      data: {
        adSetId: adSet.id,
        campaignId: campaign.id,
        metaAdId: 'ad-performance-ci',
        name: 'Anúncio Performance CI',
        status: 'ACTIVE',
        creativeId: 'creative-performance-ci',
      },
    });

    const base = {
      organizationId: admin.organizationId,
      clientId,
      adAccountId: account.id,
      spend: 100,
      impressions: 10000,
      reach: 8000,
      frequency: 1.25,
      clicks: 200,
      inlineLinkClicks: 150,
      ctr: 2,
      cpc: 0.5,
      cpm: 10,
      leads: 10,
      conversations: 5,
      purchases: 2,
      revenue: 400,
      costPerLead: 10,
      costPerConversation: 20,
    };

    await prisma.insightDaily.createMany({
      data: [
        {
          ...base,
          level: 'campaign',
          date: new Date('2026-08-10T00:00:00.000Z'),
          campaignId: 'campaign-performance-ci',
          adSetId: '',
          adId: '',
        },
        {
          ...base,
          spend: 50,
          leads: 1,
          revenue: 0,
          level: 'campaign',
          date: new Date('2026-07-10T00:00:00.000Z'),
          campaignId: 'campaign-performance-ci',
          adSetId: '',
          adId: '',
        },
        {
          ...base,
          level: 'adset',
          date: new Date('2026-08-10T00:00:00.000Z'),
          campaignId: 'campaign-performance-ci',
          adSetId: 'adset-performance-ci',
          adId: '',
        },
        {
          ...base,
          spend: 60,
          impressions: 6000,
          reach: 5000,
          clicks: 120,
          inlineLinkClicks: 100,
          leads: 7,
          conversations: 3,
          purchases: 1,
          revenue: 250,
          level: 'ad',
          date: new Date('2026-08-10T00:00:00.000Z'),
          campaignId: 'campaign-performance-ci',
          adSetId: 'adset-performance-ci',
          adId: 'ad-performance-ci',
        },
      ],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const headers = () => ({ authorization: `Bearer ${token}` });
  const query = () => `clientId=${clientId}&businessId=bm-performance-ci&since=2026-08-01&until=2026-08-31`;

  it('filtra o resumo pelo período selecionado sem somar histórico anterior', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/performance/summary?${query()}`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.spend).toBe(100);
    expect(response.json().data.leads).toBe(10);
    expect(response.json().data.purchases).toBe(2);
    expect(response.json().data.revenue).toBe(400);
    expect(response.json().data.roas).toBe(4);
    expect(response.json().data.costPerLead).toBe(10);
  });

  it('retorna campanha, conjunto e anúncio da BM com métricas próprias', async () => {
    const campaigns = await app.inject({ method: 'GET', url: `/performance/campaigns?${query()}`, headers: headers() });
    expect(campaigns.statusCode).toBe(200);
    expect(campaigns.json().data).toHaveLength(1);
    expect(campaigns.json().data[0].name).toBe('Campanha Performance CI');
    expect(campaigns.json().data[0].spend).toBe(100);

    const adSets = await app.inject({ method: 'GET', url: `/performance/adsets?${query()}`, headers: headers() });
    expect(adSets.statusCode).toBe(200);
    expect(adSets.json().data).toHaveLength(1);
    expect(adSets.json().data[0].name).toBe('Conjunto Performance CI');
    expect(adSets.json().data[0].spend).toBe(100);

    const ads = await app.inject({ method: 'GET', url: `/performance/ads?${query()}`, headers: headers() });
    expect(ads.statusCode).toBe(200);
    expect(ads.json().data).toHaveLength(1);
    expect(ads.json().data[0].name).toBe('Anúncio Performance CI');
    expect(ads.json().data[0].spend).toBe(60);
    expect(ads.json().data[0].leads).toBe(7);
    expect(ads.json().data[0].roas).toBeCloseTo(250 / 60, 5);
  });

  it('rejeita período invertido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/performance/summary?clientId=${clientId}&since=2026-08-31&until=2026-08-01`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_PERIOD');
  });
});
