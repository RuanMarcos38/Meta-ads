import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { requireAuth, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

const adminRoles = new Set(['SUPER_ADMIN', 'AGENCY_ADMIN']);
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const conversationCreateSchema = z.object({
  type: z.enum(['CHAT', 'TICKET']).default('CHAT'),
  subject: z.string().trim().min(3).max(160).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  message: z.string().trim().min(1).max(5000).optional(),
  recipientUserId: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'TICKET' && !value.message) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mensagem obrigatória para chamado.' });
  }
  if (value.type === 'CHAT' && !value.message && !value.recipientUserId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe uma mensagem ou selecione um usuário.' });
  }
});

const messageSchema = z.object({
  body: z.string().trim().max(5000).optional(),
  kind: z.enum(['TEXT', 'FILE', 'AUDIO']).default('TEXT'),
  attachment: z.object({
    name: z.string().trim().min(1).max(180),
    mime: z.string().trim().min(1).max(120),
    dataBase64: z.string().min(1),
  }).optional(),
}).superRefine((value, ctx) => {
  if (!value.body && !value.attachment) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mensagem ou anexo obrigatório.' });
});

function isAdmin(user: AuthUser) { return adminRoles.has(user.role); }

function conversationAccessWhere(user: AuthUser) {
  if (isAdmin(user)) return {};
  return { OR: [{ createdById: user.id }, { assignedToId: user.id }] };
}

function readMarker(user: AuthUser, conversation: { createdById: string; lastRequesterReadAt: Date | null; lastAdminReadAt: Date | null }) {
  return conversation.createdById === user.id ? conversation.lastRequesterReadAt : conversation.lastAdminReadAt;
}

function readUpdate(user: AuthUser, conversation: { createdById: string }, date = new Date()) {
  return conversation.createdById === user.id ? { lastRequesterReadAt: date } : { lastAdminReadAt: date };
}

async function conversationForUser(user: AuthUser, conversationId: string, reply: FastifyReply) {
  const conversation = await prisma.supportConversation.findFirst({
    where: {
      id: conversationId,
      organizationId: user.organizationId!,
      ...conversationAccessWhere(user),
    },
  });
  if (!conversation) {
    reply.code(404).send(fail('SUPPORT_CONVERSATION_NOT_FOUND', 'Conversa não encontrada para este acesso.'));
    return null;
  }
  return conversation;
}

async function resolveRecipient(user: AuthUser, recipientUserId: string, reply: FastifyReply) {
  if (recipientUserId === user.id) {
    reply.code(400).send(fail('SELF_CHAT_NOT_ALLOWED', 'Selecione outro usuário para iniciar a conversa.'));
    return null;
  }

  const recipient = await prisma.user.findFirst({
    where: { id: recipientUserId, organizationId: user.organizationId!, isActive: true },
    select: { id: true, name: true, email: true, role: true, clientId: true },
  });
  if (!recipient) {
    reply.code(404).send(fail('SUPPORT_RECIPIENT_NOT_FOUND', 'Usuário não encontrado ou inativo.'));
    return null;
  }

  if (!isAdmin(user)) {
    const recipientIsAdmin = adminRoles.has(recipient.role);
    const sameCompany = Boolean(user.clientId && recipient.clientId && user.clientId === recipient.clientId);
    if (!recipientIsAdmin && !sameCompany) {
      reply.code(403).send(fail('SUPPORT_CROSS_COMPANY_FORBIDDEN', 'Usuários só podem conversar com administradores ou pessoas da mesma empresa.'));
      return null;
    }
  }

  return recipient;
}

function decodeAttachment(attachment?: { name: string; mime: string; dataBase64: string }) {
  if (!attachment) return null;
  const normalized = attachment.dataBase64.includes(',') ? attachment.dataBase64.slice(attachment.dataBase64.indexOf(',') + 1) : attachment.dataBase64;
  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length || buffer.length > MAX_ATTACHMENT_BYTES) throw new Error('ATTACHMENT_SIZE');
  return { buffer, name: attachment.name, mime: attachment.mime };
}

function slaMinutes(priority: string) {
  if (priority === 'urgent') return 30;
  if (priority === 'high') return 120;
  if (priority === 'low') return 1440;
  return 480;
}

export async function registerSupportRoutes(app: FastifyInstance) {
  app.post('/support/presence', { preHandler: requireAuth() }, async (req) => {
    const user = req.user as AuthUser;
    await prisma.supportPresence.upsert({
      where: { userId: user.id },
      update: { organizationId: user.organizationId!, clientId: user.clientId ?? null },
      create: { userId: user.id, organizationId: user.organizationId!, clientId: user.clientId ?? null },
    });
    return ok({ online: true, at: new Date() });
  });

  app.get('/support/presence', { preHandler: requireAuth() }, async (req) => {
    const user = req.user as AuthUser;
    const activeSince = new Date(Date.now() - 35_000);
    const presences = await prisma.supportPresence.findMany({
      where: { organizationId: user.organizationId!, lastSeenAt: { gte: activeSince } },
      orderBy: { lastSeenAt: 'desc' },
    });
    const ids = presences.map((item) => item.userId);
    const users = ids.length ? await prisma.user.findMany({
      where: {
        id: { in: ids },
        organizationId: user.organizationId!,
        isActive: true,
        ...(!isAdmin(user) ? {
          OR: [
            { role: { in: ['SUPER_ADMIN', 'AGENCY_ADMIN'] } },
            ...(user.clientId ? [{ clientId: user.clientId }] : []),
          ],
        } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        clientId: true,
        client: { select: { name: true } },
      },
    }) : [];
    const presenceById = new Map(presences.map((item) => [item.userId, item.lastSeenAt]));
    return ok(users
      .map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        role: item.role,
        clientId: item.clientId,
        clientName: item.client?.name ?? null,
        lastSeenAt: presenceById.get(item.id),
      }))
      .sort((a, b) => {
        const aAdmin = adminRoles.has(a.role) ? 0 : 1;
        const bAdmin = adminRoles.has(b.role) ? 0 : 1;
        return aAdmin - bAdmin || a.name.localeCompare(b.name);
      }));
  });

  app.get('/support/summary', { preHandler: requireAuth() }, async (req) => {
    const user = req.user as AuthUser;
    const conversations = await prisma.supportConversation.findMany({
      where: { organizationId: user.organizationId!, ...conversationAccessWhere(user) },
      select: {
        id: true,
        createdById: true,
        assignedToId: true,
        status: true,
        type: true,
        priority: true,
        lastMessageAt: true,
        lastAdminReadAt: true,
        lastRequesterReadAt: true,
        firstResponseAt: true,
        createdAt: true,
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    const unread = conversations.filter((item) => {
      const marker = readMarker(user, item);
      return !marker || item.lastMessageAt > marker;
    }).length;
    const open = conversations.filter((item) => !['RESOLVED', 'CLOSED'].includes(item.status)).length;
    const breached = conversations.filter((item) => !item.firstResponseAt && Date.now() - item.createdAt.getTime() > slaMinutes(item.priority) * 60000).length;
    return ok({ total: conversations.length, open, unread, slaBreached: breached });
  });

  app.get('/support/conversations', { preHandler: requireAuth() }, async (req) => {
    const user = req.user as AuthUser;
    const conversations = await prisma.supportConversation.findMany({
      where: { organizationId: user.organizationId!, ...conversationAccessWhere(user) },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, senderId: true, kind: true, body: true, attachmentName: true, createdAt: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
    const userIds = new Set<string>();
    conversations.forEach((item) => {
      userIds.add(item.createdById);
      if (item.assignedToId) userIds.add(item.assignedToId);
    });
    const users = userIds.size ? await prisma.user.findMany({
      where: { id: { in: Array.from(userIds) }, organizationId: user.organizationId! },
      select: { id: true, name: true, email: true, role: true, clientId: true },
    }) : [];
    const userMap = new Map(users.map((item) => [item.id, item]));
    return ok(conversations.map((item) => {
      const marker = readMarker(user, item);
      const unread = !marker || item.lastMessageAt > marker;
      const sla = slaMinutes(item.priority);
      const elapsed = Math.round((Date.now() - item.createdAt.getTime()) / 60000);
      const peerId = item.createdById === user.id ? item.assignedToId : item.createdById;
      return {
        ...item,
        requester: userMap.get(item.createdById) ?? null,
        assignedTo: item.assignedToId ? userMap.get(item.assignedToId) ?? null : null,
        peer: peerId ? userMap.get(peerId) ?? null : null,
        lastMessage: item.messages[0] ?? null,
        messages: undefined,
        unread,
        slaMinutes: sla,
        slaBreached: !item.firstResponseAt && elapsed > sla,
      };
    }));
  });

  app.post('/support/conversations', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const parsed = conversationCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(fail('VALIDATION', 'Dados da conversa ou chamado inválidos.'));
    if (parsed.data.type === 'TICKET' && !parsed.data.subject) return reply.code(400).send(fail('SUBJECT_REQUIRED', 'Informe o assunto do chamado.'));

    let recipient: Awaited<ReturnType<typeof resolveRecipient>> = null;
    if (parsed.data.type === 'CHAT' && parsed.data.recipientUserId) {
      recipient = await resolveRecipient(user, parsed.data.recipientUserId, reply);
      if (!recipient) return;

      const existing = await prisma.supportConversation.findFirst({
        where: {
          organizationId: user.organizationId!,
          type: 'CHAT',
          status: { in: ['OPEN', 'PENDING'] },
          OR: [
            { createdById: user.id, assignedToId: recipient.id },
            { createdById: recipient.id, assignedToId: user.id },
          ],
        },
        orderBy: { lastMessageAt: 'desc' },
      });
      if (existing) return ok(existing, 'Conversa existente aberta.');
    }

    const now = new Date();
    const conversation = await prisma.$transaction(async (tx) => {
      const created = await tx.supportConversation.create({
        data: {
          organizationId: user.organizationId!,
          clientId: user.clientId ?? recipient?.clientId ?? null,
          createdById: user.id,
          assignedToId: recipient?.id ?? null,
          type: parsed.data.type,
          subject: parsed.data.subject ?? (parsed.data.type === 'CHAT'
            ? recipient ? `Conversa com ${recipient.name}` : 'Conversa com atendimento'
            : null),
          priority: parsed.data.priority,
          lastRequesterReadAt: now,
          lastAdminReadAt: null,
        },
      });
      if (parsed.data.message) {
        await tx.supportMessage.create({
          data: { conversationId: created.id, senderId: user.id, kind: 'TEXT', body: parsed.data.message },
        });
      }
      return created;
    });
    return ok(conversation, parsed.data.type === 'TICKET' ? 'Chamado aberto.' : 'Conversa iniciada.');
  });

  app.get('/support/conversations/:id/messages', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send(fail('VALIDATION', 'Conversa inválida.'));
    const conversation = await conversationForUser(user, params.data.id, reply);
    if (!conversation) return;
    const messages = await prisma.supportMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, conversationId: true, senderId: true, kind: true, body: true, attachmentName: true, attachmentMime: true, attachmentSize: true, createdAt: true },
    });
    const senderIds = Array.from(new Set(messages.map((item) => item.senderId)));
    const senders = senderIds.length ? await prisma.user.findMany({
      where: { id: { in: senderIds }, organizationId: user.organizationId! },
      select: { id: true, name: true, email: true, role: true },
    }) : [];
    const senderMap = new Map(senders.map((item) => [item.id, item]));
    return ok(messages.map((item) => ({ ...item, sender: senderMap.get(item.senderId) ?? null })));
  });

  app.post('/support/conversations/:id/read', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send(fail('VALIDATION', 'Conversa inválida.'));
    const conversation = await conversationForUser(user, params.data.id, reply);
    if (!conversation) return;
    const updated = await prisma.supportConversation.update({
      where: { id: conversation.id },
      data: readUpdate(user, conversation),
    });
    return ok(updated);
  });

  app.post('/support/conversations/:id/messages', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const parsed = messageSchema.safeParse(req.body);
    if (!params.success || !parsed.success) return reply.code(400).send(fail('VALIDATION', 'Mensagem inválida.'));
    const conversation = await conversationForUser(user, params.data.id, reply);
    if (!conversation) return;
    if (conversation.status === 'CLOSED') return reply.code(409).send(fail('CONVERSATION_CLOSED', 'Esta conversa está encerrada.'));
    let attachment: ReturnType<typeof decodeAttachment> = null;
    try {
      attachment = decodeAttachment(parsed.data.attachment);
    } catch {
      return reply.code(413).send(fail('ATTACHMENT_TOO_LARGE', 'O arquivo deve ter no máximo 8 MB.'));
    }
    const now = new Date();
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.supportMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          kind: attachment ? parsed.data.kind : 'TEXT',
          body: parsed.data.body || null,
          attachmentName: attachment?.name ?? null,
          attachmentMime: attachment?.mime ?? null,
          attachmentSize: attachment?.buffer.length ?? null,
          attachmentData: attachment?.buffer ?? null,
        },
        select: { id: true, conversationId: true, senderId: true, kind: true, body: true, attachmentName: true, attachmentMime: true, attachmentSize: true, createdAt: true },
      });
      await tx.supportConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: now,
          ...(user.id !== conversation.createdById && !conversation.firstResponseAt ? { firstResponseAt: now } : {}),
          ...readUpdate(user, conversation, now),
          ...((isAdmin(user) || user.id === conversation.assignedToId) && conversation.status === 'PENDING' ? { status: 'OPEN' } : {}),
        },
      });
      return created;
    });
    return ok(message, 'Mensagem enviada.');
  });

  app.get('/support/messages/:id/attachment', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send(fail('VALIDATION', 'Anexo inválido.'));
    const message = await prisma.supportMessage.findFirst({ where: { id: params.data.id }, include: { conversation: true } });
    if (!message || message.conversation.organizationId !== user.organizationId) {
      return reply.code(404).send(fail('ATTACHMENT_NOT_FOUND', 'Anexo não encontrado para este acesso.'));
    }
    const canAccess = isAdmin(user) || message.conversation.createdById === user.id || message.conversation.assignedToId === user.id;
    if (!canAccess) return reply.code(404).send(fail('ATTACHMENT_NOT_FOUND', 'Anexo não encontrado para este acesso.'));
    if (!message.attachmentData || !message.attachmentName) return reply.code(404).send(fail('ATTACHMENT_NOT_FOUND', 'Esta mensagem não possui anexo.'));
    const safeName = message.attachmentName.replace(/[\r\n"\\/]/g, '_');
    reply.header('Content-Type', message.attachmentMime || 'application/octet-stream');
    reply.header('Content-Length', String(message.attachmentData.length));
    reply.header('Content-Disposition', `inline; filename="${safeName}"`);
    return reply.send(message.attachmentData);
  });

  app.patch('/support/conversations/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const params = z.object({ id: z.string().uuid() }).safeParse(req.params);
    const body = z.object({
      status: z.enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      assignToMe: z.boolean().optional(),
    }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send(fail('VALIDATION', 'Atualização do chamado inválida.'));
    const conversation = await conversationForUser(user, params.data.id, reply);
    if (!conversation) return;
    if (!isAdmin(user) && (body.data.priority || body.data.assignToMe || (body.data.status && !['OPEN', 'CLOSED'].includes(body.data.status)))) {
      return reply.code(403).send(fail('FORBIDDEN', 'Somente administradores podem alterar prioridade, responsável ou fluxo do chamado.'));
    }
    const updated = await prisma.supportConversation.update({
      where: { id: conversation.id },
      data: {
        ...(body.data.status ? { status: body.data.status } : {}),
        ...(body.data.priority ? { priority: body.data.priority } : {}),
        ...(body.data.assignToMe && isAdmin(user) && !conversation.assignedToId ? { assignedToId: user.id } : {}),
      },
    });
    return ok(updated, 'Atendimento atualizado.');
  });
}
