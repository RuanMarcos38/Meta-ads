import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

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
