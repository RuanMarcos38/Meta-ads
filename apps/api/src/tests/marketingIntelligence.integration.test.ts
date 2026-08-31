import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@r2rmarketingdigital.com.br';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';
const suite = integrationEnabled ? describe : describe.skip;

suite('Marketing intelligence integration flow', () => {
  let app: FastifyInstance;
  let token = '';
  let clientId = '';

  beforeAll(async () => {
    if (!adminPassword) throw new Error('SEED_ADMIN_PASSWORD é obrigatória para o teste de integração.');
    app = await buildApp();
    await app.ready();

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: adminEmail, password: adminPassword } });
    expect(login.statusCode).toBe(200);
    token = login.json().data.token;

    const created = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: `Marketing Intelligence CI ${Date.now()}`, segment: 'Teste automatizado' },
    });
    expect(created.statusCode).toBe(200);
    clientId = created.json().data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('protege as rotas sem autenticação', async () => {
    const response = await app.inject({ method: 'GET', url: `/workspace/google-analytics/config?clientId=${clientId}` });
    expect(response.statusCode).toBe(401);
  });

  it('retorna Google Analytics não configurado sem expor segredo', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/workspace/google-analytics/config?clientId=${clientId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.configured).toBe(false);
    expect(response.json().data.privateKeyEncrypted).toBeUndefined();
  });

  it('rejeita credencial GA incompleta', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/workspace/google-analytics/config',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        clientId,
        propertyId: '123456789',
        serviceAccountJson: JSON.stringify({ client_email: 'ci@example.test', project_id: 'ci' }),
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('GA_CREDENTIAL_INVALID');
  });

  it('não inventa financeiro quando a Meta não está conectada', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/workspace/finance?clientId=${clientId}&since=2026-08-01&until=2026-08-31`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('META_NOT_CONNECTED');
  });

  it('mantém Pixel vazio quando não há integração Meta em vez de criar dados fictícios', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/workspace/meta-pixels?clientId=${clientId}&businessId=123456789`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.configured).toBe(false);
    expect(response.json().data.pixels).toEqual([]);
  });
});
