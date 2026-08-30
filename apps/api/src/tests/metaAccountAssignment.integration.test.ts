import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../shared/prisma.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@r2rmarketingdigital.com.br';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';
const suite = integrationEnabled ? describe : describe.skip;

suite('Meta account assignment compatibility', () => {
  let app: FastifyInstance;
  let token = '';
  let accountId = '';

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
      data: {
        organizationId: admin.organizationId,
        name: 'Cliente autorização Meta CI',
      },
    });

    const connection = await prisma.metaConnection.create({
      data: {
        organizationId: admin.organizationId,
        clientId: client.id,
        accessTokenEncrypted: 'ci-token-not-used-by-assignment-route',
        status: 'active',
      },
    });

    const account = await prisma.metaAdAccount.create({
      data: {
        organizationId: admin.organizationId,
        clientId: client.id,
        connectionId: connection.id,
        accountId: '999000111222333',
        name: 'Ecojoi CI',
        currency: 'BRL',
        isActive: true,
        isAssigned: false,
      },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('publica a capacidade de autorização compatível', async () => {
    const response = await app.inject({ method: 'GET', url: '/meta/account-assignment-capability' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.enabled).toBe(true);
    expect(response.json().data.version).toBe('2026.08.29.1');
  });

  it('autoriza e remove uma conta Meta por POST sem depender da consulta de BM', async () => {
    const headers = { authorization: `Bearer ${token}` };

    const authorize = await app.inject({
      method: 'POST',
      url: `/meta/client-accounts/${accountId}/assignment`,
      headers,
      payload: { isAssigned: true },
    });

    expect(authorize.statusCode).toBe(200);
    expect(authorize.json().success).toBe(true);
    expect(authorize.json().data.isAssigned).toBe(true);

    const saved = await prisma.metaAdAccount.findUnique({ where: { id: accountId } });
    expect(saved?.isAssigned).toBe(true);

    const remove = await app.inject({
      method: 'POST',
      url: `/meta/client-accounts/${accountId}/assignment`,
      headers,
      payload: { isAssigned: false },
    });

    expect(remove.statusCode).toBe(200);
    expect(remove.json().data.isAssigned).toBe(false);
  });
});
