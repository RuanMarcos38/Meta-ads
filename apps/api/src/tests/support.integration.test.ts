import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../shared/prisma.js';
import { hashPassword } from '../shared/password.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@r2rmarketingdigital.com.br';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';
const suite = integrationEnabled ? describe : describe.skip;

suite('internal support flow', () => {
  let app: FastifyInstance;
  let token = '';
  let conversationId = '';
  let attachmentMessageId = '';
  let sameCompanyTokenA = '';
  let sameCompanyTokenB = '';
  let otherCompanyUserId = '';
  let sameCompanyUserBId = '';

  beforeAll(async () => {
    if (!adminPassword) throw new Error('SEED_ADMIN_PASSWORD é obrigatória para o teste de suporte.');
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
    if (!admin?.organizationId) throw new Error('Administrador sem organização no teste.');

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const companyA = await prisma.client.create({ data: { organizationId: admin.organizationId, name: `Empresa A ${suffix}` } });
    const companyB = await prisma.client.create({ data: { organizationId: admin.organizationId, name: `Empresa B ${suffix}` } });
    const password = 'SupportTest123!';
    const passwordHash = await hashPassword(password);

    const userA = await prisma.user.create({
      data: { organizationId: admin.organizationId, clientId: companyA.id, name: 'Usuário A', email: `support-a-${suffix}@test.local`, passwordHash, role: 'CLIENT', isActive: true },
    });
    const userB = await prisma.user.create({
      data: { organizationId: admin.organizationId, clientId: companyA.id, name: 'Usuário B', email: `support-b-${suffix}@test.local`, passwordHash, role: 'CLIENT', isActive: true },
    });
    const userC = await prisma.user.create({
      data: { organizationId: admin.organizationId, clientId: companyB.id, name: 'Usuário C', email: `support-c-${suffix}@test.local`, passwordHash, role: 'CLIENT', isActive: true },
    });
    sameCompanyUserBId = userB.id;
    otherCompanyUserId = userC.id;

    const loginA = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: userA.email, password } });
    const loginB = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: userB.email, password } });
    expect(loginA.statusCode).toBe(200);
    expect(loginB.statusCode).toBe(200);
    sameCompanyTokenA = loginA.json().data.token;
    sameCompanyTokenB = loginB.json().data.token;

    await app.inject({ method: 'POST', url: '/support/presence', headers: { authorization: `Bearer ${sameCompanyTokenA}` } });
    await app.inject({ method: 'POST', url: '/support/presence', headers: { authorization: `Bearer ${sameCompanyTokenB}` } });
    const loginC = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: userC.email, password } });
    await app.inject({ method: 'POST', url: '/support/presence', headers: { authorization: `Bearer ${loginC.json().data.token}` } });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('registra presença online e lista a equipe ativa', async () => {
    const heartbeat = await app.inject({
      method: 'POST',
      url: '/support/presence',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().data.online).toBe(true);

    const presence = await app.inject({
      method: 'GET',
      url: '/support/presence',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(presence.statusCode).toBe(200);
    expect(presence.json().data.some((item: { email: string }) => item.email === adminEmail)).toBe(true);
  });

  it('mostra usuários da mesma empresa e bloqueia outra empresa', async () => {
    const presence = await app.inject({
      method: 'GET',
      url: '/support/presence',
      headers: { authorization: `Bearer ${sameCompanyTokenA}` },
    });
    expect(presence.statusCode).toBe(200);
    const visibleIds = presence.json().data.map((item: { id: string }) => item.id);
    expect(visibleIds).toContain(sameCompanyUserBId);
    expect(visibleIds).not.toContain(otherCompanyUserId);

    const sameCompanyChat = await app.inject({
      method: 'POST',
      url: '/support/conversations',
      headers: { authorization: `Bearer ${sameCompanyTokenA}` },
      payload: { type: 'CHAT', recipientUserId: sameCompanyUserBId },
    });
    expect(sameCompanyChat.statusCode).toBe(200);

    const recipientList = await app.inject({
      method: 'GET',
      url: '/support/conversations',
      headers: { authorization: `Bearer ${sameCompanyTokenB}` },
    });
    expect(recipientList.statusCode).toBe(200);
    expect(recipientList.json().data.some((item: { id: string }) => item.id === sameCompanyChat.json().data.id)).toBe(true);

    const crossCompany = await app.inject({
      method: 'POST',
      url: '/support/conversations',
      headers: { authorization: `Bearer ${sameCompanyTokenA}` },
      payload: { type: 'CHAT', recipientUserId: otherCompanyUserId },
    });
    expect(crossCompany.statusCode).toBe(403);
  });

  it('abre uma conversa interna e mantém histórico', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/support/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { type: 'CHAT', message: 'Mensagem inicial do teste interno.' },
    });
    expect(created.statusCode).toBe(200);
    conversationId = created.json().data.id;
    expect(conversationId).toBeTruthy();

    const listed = await app.inject({
      method: 'GET',
      url: '/support/conversations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.some((item: { id: string }) => item.id === conversationId)).toBe(true);
  });

  it('envia arquivo interno e recupera o binário autenticado', async () => {
    const content = Buffer.from('arquivo interno de teste', 'utf8');
    const sent = await app.inject({
      method: 'POST',
      url: `/support/conversations/${conversationId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        body: 'Segue o arquivo.',
        kind: 'FILE',
        attachment: {
          name: 'teste.txt',
          mime: 'text/plain',
          dataBase64: content.toString('base64'),
        },
      },
    });
    expect(sent.statusCode).toBe(200);
    attachmentMessageId = sent.json().data.id;

    const messages = await app.inject({
      method: 'GET',
      url: `/support/conversations/${conversationId}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(messages.statusCode).toBe(200);
    const attachment = messages.json().data.find((item: { id: string }) => item.id === attachmentMessageId);
    expect(attachment.attachmentName).toBe('teste.txt');
    expect(attachment.attachmentSize).toBe(content.length);

    const downloaded = await app.inject({
      method: 'GET',
      url: `/support/messages/${attachmentMessageId}/attachment`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers['content-type']).toContain('text/plain');
    expect(downloaded.rawPayload.toString('utf8')).toBe(content.toString('utf8'));
  });

  it('abre chamado e permite gestão de status', async () => {
    const ticket = await app.inject({
      method: 'POST',
      url: '/support/conversations',
      headers: { authorization: `Bearer ${token}` },
      payload: { type: 'TICKET', subject: 'Teste de solicitação', priority: 'high', message: 'Validar o fluxo do chamado.' },
    });
    expect(ticket.statusCode).toBe(200);
    const ticketId = ticket.json().data.id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/support/conversations/${ticketId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { assignToMe: true, status: 'RESOLVED' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.status).toBe('RESOLVED');
    expect(updated.json().data.assignedToId).toBeTruthy();
  });
});
