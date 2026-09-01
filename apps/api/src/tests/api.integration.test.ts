import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../shared/prisma.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@r2rmarketingdigital.com.br';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';

const suite = integrationEnabled ? describe : describe.skip;

suite('API integration flow', () => {
  let app: FastifyInstance;
  let token = '';
  let refresh = '';

  beforeAll(async () => {
    if (!adminPassword) throw new Error('SEED_ADMIN_PASSWORD é obrigatória para o teste de integração.');
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('confirma liveness, banco e administrador ativo', async () => {
    const live = await app.inject({ method: 'GET', url: '/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json().data.status).toBe('up');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().data.database).toBe('connected');
    expect(health.json().data.schema).toBe('gestao_ads');

    const status = await app.inject({ method: 'GET', url: '/auth/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.ready).toBe(true);
    expect(status.json().data.activeUsers).toBeGreaterThan(0);
  });

  it('rejeita senha inválida sem revelar detalhes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: adminEmail, password: `${adminPassword}-invalid` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('faz login real e renova o token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: adminEmail, password: adminPassword },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(adminEmail);
    expect(body.data.user.role).toBe('SUPER_ADMIN');
    expect(body.data.token).toBeTruthy();
    expect(body.data.refresh).toBeTruthy();

    token = body.data.token;
    refresh = body.data.refresh;

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data.token).toBeTruthy();
  });

  it('valida sessão autenticada e o perfil atual', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.email).toBe(adminEmail);
    expect(response.json().data.role).toBe('SUPER_ADMIN');
  });

  it('cadastra e lista cliente com auditoria', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Cliente Integração CI',
        companyName: 'R2R Teste Automatizado',
        email: 'integracao-ci@example.com',
        segment: 'Teste',
      },
    });

    expect(created.statusCode).toBe(200);
    expect(created.json().data.name).toBe('Cliente Integração CI');

    const listed = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.some((client: { name: string }) => client.name === 'Cliente Integração CI')).toBe(true);
  });

  it('mantém um único login com acesso seguro a múltiplas empresas e BMs', async () => {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail }, select: { organizationId: true } });
    expect(admin?.organizationId).toBeTruthy();
    const organizationId = admin!.organizationId!;

    const primary = await prisma.client.create({ data: { organizationId, name: 'Empresa Multi A' } });
    const secondary = await prisma.client.create({ data: { organizationId, name: 'Empresa Multi B' } });
    const forbidden = await prisma.client.create({ data: { organizationId, name: 'Empresa Fora do Acesso' } });

    await prisma.businessManager.createMany({
      data: [
        { organizationId, clientId: primary.id, metaBusinessId: 'bm-multi-a', name: 'BM Multi A', status: 'active' },
        { organizationId, clientId: secondary.id, metaBusinessId: 'bm-multi-b', name: 'BM Multi B', status: 'active' },
      ],
    });

    const multiEmail = 'multiempresa-ci@example.com';
    const password = 'MultiEmpresa#2026!';
    const created = await app.inject({
      method: 'POST',
      url: '/workspace/users',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Usuário Multiempresa CI',
        email: multiEmail,
        password,
        role: 'CLIENT',
        clientId: primary.id,
        businessId: 'bm-multi-a',
        clientIds: [primary.id, secondary.id],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.clientIds).toEqual(expect.arrayContaining([primary.id, secondary.id]));

    const persisted = await prisma.user.findUnique({
      where: { email: multiEmail },
      select: { clientId: true, businessId: true, clientIdsJson: true, mustChangePassword: true },
    });
    expect(persisted?.clientId).toBe(primary.id);
    expect(persisted?.businessId).toBe('bm-multi-a');
    expect(persisted?.clientIdsJson).toEqual(expect.arrayContaining([primary.id, secondary.id]));
    expect(persisted?.mustChangePassword).toBe(true);

    const visibleFromSecondary = await app.inject({
      method: 'GET',
      url: `/workspace/users?clientId=${secondary.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(visibleFromSecondary.statusCode).toBe(200);
    expect(visibleFromSecondary.json().data.some((item: { email: string }) => item.email === multiEmail)).toBe(true);

    // O produto mantém a política já existente de troca obrigatória da senha temporária.
    // Para este teste de escopo, liberamos apenas o usuário efêmero criado no banco isolado de CI.
    await prisma.user.update({ where: { email: multiEmail }, data: { mustChangePassword: false } });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: multiEmail, password },
    });
    expect(login.statusCode).toBe(200);
    const multiToken = login.json().data.token as string;

    const context = await app.inject({
      method: 'GET',
      url: '/workspace/context',
      headers: { authorization: `Bearer ${multiToken}` },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json().data.tenantLocked).toBe(false);
    expect(context.json().data.clients.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([primary.id, secondary.id]));
    expect(context.json().data.businesses.map((item: { metaBusinessId: string }) => item.metaBusinessId)).toEqual(expect.arrayContaining(['bm-multi-a', 'bm-multi-b']));

    const secondaryManagers = await app.inject({
      method: 'GET',
      url: `/workspace/business-managers?clientId=${secondary.id}`,
      headers: { authorization: `Bearer ${multiToken}` },
    });
    expect(secondaryManagers.statusCode).toBe(200);
    expect(secondaryManagers.json().data.some((item: { metaBusinessId: string }) => item.metaBusinessId === 'bm-multi-b')).toBe(true);

    const blocked = await app.inject({
      method: 'GET',
      url: `/workspace/context?clientId=${forbidden.id}`,
      headers: { authorization: `Bearer ${multiToken}` },
    });
    expect(blocked.statusCode).toBe(403);
  });

  it('carrega dashboard, campanhas e executa sincronização em modo de teste', async () => {
    for (const url of ['/dashboard/summary', '/dashboard/daily', '/dashboard/campaigns']) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    }

    const sync = await app.inject({
      method: 'POST',
      url: '/dashboard/sync',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(sync.statusCode).toBe(200);
    expect(sync.json().success).toBe(true);
    expect(sync.json().data.jobId).toBe('demo');
  });

  it('lista alertas e auditoria do administrador', async () => {
    const alerts = await app.inject({
      method: 'GET',
      url: '/alerts',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(alerts.statusCode).toBe(200);
    expect(Array.isArray(alerts.json().data)).toBe(true);

    const audit = await app.inject({
      method: 'GET',
      url: '/audit-logs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().data.some((entry: { action: string }) => entry.action === 'LOGIN')).toBe(true);
    expect(audit.json().data.some((entry: { action: string }) => entry.action === 'CREATE_CLIENT')).toBe(true);
  });

  it('encerra a sessão no backend', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
  });
});
