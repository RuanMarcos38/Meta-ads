import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@r2rmarketingdigital.com.br';
const adminPassword = process.env.SEED_ADMIN_PASSWORD || '';
const suite = integrationEnabled ? describe : describe.skip;

suite('internal support flow', () => {
  let app: FastifyInstance;
  let token = '';
  let conversationId = '';
  let attachmentMessageId = '';

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
