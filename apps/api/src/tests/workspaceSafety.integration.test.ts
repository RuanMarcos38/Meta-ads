import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { normalizeWorkspaceContextCounts } from '../workspaceSafetyHooks.js';
import { prisma } from '../shared/prisma.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@r2rmarketingdigital.com.br';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';
const suite = integrationEnabled ? describe : describe.skip;

describe('normalização dos contadores do escopo', () => {
  it('conta somente BMs ativas e contas realmente autorizadas', () => {
    const normalized = normalizeWorkspaceContextCounts({
      success: true,
      data: {
        clients: [
          { id: 'client-a', _count: { users: 2, businessManagers: 13, adAccounts: 9 } },
          { id: 'client-b', _count: { users: 1, businessManagers: 4, adAccounts: 2 } },
        ],
        businesses: [
          { clientId: 'client-a', status: 'active' },
          { clientId: 'client-a', status: 'inactive' },
          { clientId: 'client-a', status: 'inactive' },
          { clientId: 'client-b', status: 'active' },
          { clientId: 'client-b', status: 'active' },
        ],
        accounts: [
          { clientId: 'client-a', isAssigned: true, isActive: true },
          { clientId: 'client-a', isAssigned: false, isActive: true },
          { clientId: 'client-a', isAssigned: true, isActive: false },
          { clientId: 'client-b', isAssigned: true, isActive: true },
          { clientId: 'client-b', isAssigned: true, isActive: true },
        ],
      },
    });

    expect(normalized.data?.clients?.[0]._count).toEqual({ users: 2, businessManagers: 1, adAccounts: 1 });
    expect(normalized.data?.clients?.[1]._count).toEqual({ users: 1, businessManagers: 2, adAccounts: 2 });
  });
});

suite('isolamento de empresa, BM e Google Analytics', () => {
  let app: FastifyInstance;
  let token = '';
  let organizationId = '';
  const createdClientIds: string[] = [];

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
    token = login.json().data.token as string;

    const admin = await prisma.user.findUnique({ where: { email: adminEmail }, select: { organizationId: true } });
    if (!admin?.organizationId) throw new Error('Administrador de CI sem organização.');
    organizationId = admin.organizationId;
  });

  afterAll(async () => {
    if (createdClientIds.length) {
      await prisma.googleAnalyticsConnection.deleteMany({ where: { clientId: { in: createdClientIds } } });
      await prisma.businessManager.deleteMany({ where: { clientId: { in: createdClientIds } } });
      await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    }
    if (app) await app.close();
  });

  it('não exibe 13 BMs quando somente uma BM está ativa para a empresa', async () => {
    const client = await prisma.client.create({
      data: { organizationId, name: `Empresa Escopo ${randomUUID().slice(0, 8)}` },
    });
    createdClientIds.push(client.id);

    await prisma.businessManager.createMany({
      data: [
        { organizationId, clientId: client.id, metaBusinessId: `bm-active-${randomUUID()}`, name: 'BM correta', status: 'active' },
        ...Array.from({ length: 12 }, (_, index) => ({
          organizationId,
          clientId: client.id,
          metaBusinessId: `bm-old-${index}-${randomUUID()}`,
          name: `BM histórica ${index + 1}`,
          status: 'inactive',
        })),
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/workspace/context',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);

    const row = response.json().data.clients.find((item: { id: string }) => item.id === client.id);
    expect(row).toBeTruthy();
    expect(row._count.businessManagers).toBe(1);
  });

  it('transforma o refresh legado em atualização segura sem importar todas as BMs', async () => {
    const client = await prisma.client.create({
      data: { organizationId, name: `Empresa Refresh ${randomUUID().slice(0, 8)}` },
    });
    createdClientIds.push(client.id);

    const active = await prisma.businessManager.create({
      data: { organizationId, clientId: client.id, metaBusinessId: `bm-selected-${randomUUID()}`, name: 'BM selecionada', status: 'active' },
    });
    const inactive = await prisma.businessManager.create({
      data: { organizationId, clientId: client.id, metaBusinessId: `bm-stale-${randomUUID()}`, name: 'BM não autorizada', status: 'inactive' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/workspace/business-managers/refresh',
      headers: { authorization: `Bearer ${token}` },
      payload: { clientId: client.id },
    });

    expect(response.headers['x-gestao-bm-refresh-mode']).toBe('explicit-selection');
    expect([200, 409, 502]).toContain(response.statusCode);

    const [activeAfter, inactiveAfter] = await Promise.all([
      prisma.businessManager.findUnique({ where: { id: active.id }, select: { status: true } }),
      prisma.businessManager.findUnique({ where: { id: inactive.id }, select: { status: true } }),
    ]);
    expect(activeAfter?.status).toBe('active');
    expect(inactiveAfter?.status).toBe('inactive');
  });

  it('mantém uma conexão Google Analytics separada para cada cliente', async () => {
    const clientA = await prisma.client.create({ data: { organizationId, name: `GA A ${randomUUID().slice(0, 8)}` } });
    const clientB = await prisma.client.create({ data: { organizationId, name: `GA B ${randomUUID().slice(0, 8)}` } });
    createdClientIds.push(clientA.id, clientB.id);

    await prisma.googleAnalyticsConnection.createMany({
      data: [
        { organizationId, clientId: clientA.id, propertyId: '111111111', propertyName: 'Propriedade Cliente A', status: 'active' },
        { organizationId, clientId: clientB.id, propertyId: '222222222', propertyName: 'Propriedade Cliente B', status: 'active' },
      ],
    });

    const statusA = await app.inject({
      method: 'GET',
      url: `/google-analytics/status?clientId=${clientA.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const statusB = await app.inject({
      method: 'GET',
      url: `/google-analytics/status?clientId=${clientB.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(statusA.statusCode).toBe(200);
    expect(statusB.statusCode).toBe(200);
    expect(statusA.json().data.rows).toHaveLength(1);
    expect(statusB.json().data.rows).toHaveLength(1);
    expect(statusA.json().data.rows[0]).toMatchObject({ clientId: clientA.id, propertyId: '111111111' });
    expect(statusB.json().data.rows[0]).toMatchObject({ clientId: clientB.id, propertyId: '222222222' });
  });
});
