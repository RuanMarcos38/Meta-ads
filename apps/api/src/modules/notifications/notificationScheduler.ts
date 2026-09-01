import axios from 'axios';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../../config/env.js';
import { decrypt } from '../../shared/crypto.js';
import { prisma } from '../../shared/prisma.js';

const LOW_BALANCE_THRESHOLD_BRL = 10;
const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';
const ZERO_DECIMAL_CURRENCIES = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

export function normalizePhone(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return digits;
  return '';
}

function numberPt(value: number, decimals = 0) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(value) ? value : 0);
}

function currencyPt(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function buildDailySummaryMessage(input: {
  companyName: string;
  businessName: string;
  spend: number;
  conversations: number;
  impressions: number;
  reach: number;
}) {
  const costPerConversation = input.conversations ? input.spend / input.conversations : 0;
  const frequency = input.reach ? input.impressions / input.reach : 0;
  const cpm = input.impressions ? input.spend / input.impressions * 1000 : 0;
  return [
    `📊 *Resumo diário — ${input.companyName}*`,
    `🏢 *BM:* ${input.businessName}`,
    '',
    `💰 *Investimento total:* ${currencyPt(input.spend)}`,
    `🎯 *Conversas iniciadas:* ${numberPt(input.conversations)}`,
    `💬 *Custo por conversa:* ${currencyPt(costPerConversation)}`,
    `👁️ *Impressões:* ${numberPt(input.impressions)}`,
    `📍 *Alcance:* ${numberPt(input.reach)} pessoas`,
    `🔁 *Frequência média:* ${numberPt(frequency, 2)}`,
    `📌 *CPM médio:* ${currencyPt(cpm)}`,
  ].join('\n');
}

function localClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour') || 0),
    minute: Number(value('minute') || 0),
  };
}

export function shouldSendDailySummary(now = new Date()) {
  const clock = localClock(now);
  return clock.hour === 23 && clock.minute >= 55;
}

function minorToMajor(value: unknown, currency: string) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric / (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100);
}

function graphBaseUrl() {
  return `https://graph.facebook.com/${env.meta.apiVersion}`;
}

function whatsappReady() {
  return Boolean(env.whatsapp.baseUrl && env.whatsapp.apiKey && env.whatsapp.instance);
}

async function sendWhatsApp(phone: string, text: string) {
  if (!whatsappReady()) throw new Error('WhatsApp não configurado no EasyPanel.');
  const number = normalizePhone(phone);
  if (!number) throw new Error('Telefone da empresa ausente ou inválido.');
  const baseUrl = env.whatsapp.baseUrl.replace(/\/$/, '');
  await axios.post(`${baseUrl}/message/sendText/${encodeURIComponent(env.whatsapp.instance)}`, {
    number,
    text,
  }, {
    headers: { apikey: env.whatsapp.apiKey, 'content-type': 'application/json' },
    timeout: 20_000,
  });
}

async function createConfigAlert(input: {
  organizationId: string;
  clientId: string;
  businessId?: string | null;
  type: 'WHATSAPP_CONFIGURATION_REQUIRED' | 'WHATSAPP_PHONE_REQUIRED';
  title: string;
  message: string;
}) {
  const recent = await prisma.alert.findFirst({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      businessId: input.businessId || null,
      type: input.type,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (!recent) {
    await prisma.alert.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        businessId: input.businessId || null,
        type: input.type,
        severity: 'critical',
        title: input.title,
        message: input.message,
      },
    });
  }
}

async function canSendForClient(input: { organizationId: string; clientId: string; businessId?: string | null; phone?: string | null }) {
  if (!whatsappReady()) {
    await createConfigAlert({
      organizationId: input.organizationId,
      clientId: input.clientId,
      businessId: input.businessId,
      type: 'WHATSAPP_CONFIGURATION_REQUIRED',
      title: 'WhatsApp automático precisa ser configurado',
      message: 'Configure EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE no EasyPanel para liberar alertas e resumos automáticos.',
    });
    return false;
  }
  if (!normalizePhone(input.phone)) {
    await createConfigAlert({
      organizationId: input.organizationId,
      clientId: input.clientId,
      businessId: input.businessId,
      type: 'WHATSAPP_PHONE_REQUIRED',
      title: 'Telefone da empresa necessário para alertas',
      message: 'Cadastre um telefone válido na empresa para receber alertas de saldo e o resumo diário das campanhas.',
    });
    return false;
  }
  return true;
}

async function lowBalanceCheck(logger: FastifyBaseLogger) {
  const accounts = await prisma.metaAdAccount.findMany({
    where: { isActive: true, isAssigned: true },
    include: {
      connection: true,
      client: { select: { id: true, name: true, phone: true } },
    },
    orderBy: [{ clientId: 'asc' }, { businessName: 'asc' }, { name: 'asc' }],
  });

  for (const account of accounts) {
    if (account.connection.status !== 'active') continue;
    try {
      const token = decrypt(account.connection.accessTokenEncrypted);
      const actId = String(account.accountId).startsWith('act_') ? String(account.accountId) : `act_${account.accountId}`;
      const response = await axios.get(`${graphBaseUrl()}/${actId}`, {
        params: { fields: 'account_id,name,currency,balance', access_token: token },
        timeout: 20_000,
      });
      const currency = String(response.data?.currency || account.currency || '').toUpperCase();
      if (currency !== 'BRL') continue;
      const balance = minorToMajor(response.data?.balance, currency);
      if (balance >= LOW_BALANCE_THRESHOLD_BRL) continue;

      const accountName = String(response.data?.name || account.name || `Conta ${account.accountId}`);
      const businessName = account.businessName || account.businessId || 'BM não identificada';
      const title = `Saldo Meta abaixo de R$ 10,00 — ${accountName}`;
      const message = `A conta ${accountName} da BM ${businessName} está com saldo de ${currencyPt(balance)}. Faça uma recarga para evitar interrupção das campanhas.`;
      const recent = await prisma.alert.findFirst({
        where: {
          organizationId: account.organizationId,
          clientId: account.clientId,
          businessId: account.businessId || null,
          adAccountId: account.id,
          type: 'LOW_META_BALANCE',
          createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (recent) continue;

      await prisma.alert.create({
        data: {
          organizationId: account.organizationId,
          clientId: account.clientId,
          businessId: account.businessId || null,
          adAccountId: account.id,
          type: 'LOW_META_BALANCE',
          severity: 'critical',
          title,
          message,
        },
      });

      if (!(await canSendForClient({ organizationId: account.organizationId, clientId: account.clientId, businessId: account.businessId, phone: account.client.phone }))) continue;

      const whatsappText = [
        '🚨 *Alerta de saldo Meta Ads*',
        `🏢 *Empresa:* ${account.client.name}`,
        `📁 *BM:* ${businessName}`,
        `💳 *Conta:* ${accountName}`,
        `💰 *Saldo atual:* ${currencyPt(balance)}`,
        '',
        'O saldo está abaixo de R$ 10,00. Recarregue a conta para evitar interrupção das campanhas.',
      ].join('\n');
      try {
        await sendWhatsApp(account.client.phone!, whatsappText);
        await prisma.auditLog.create({
          data: {
            organizationId: account.organizationId,
            businessId: account.businessId,
            action: 'WHATSAPP_LOW_BALANCE_SENT',
            entity: 'MetaAdAccount',
            entityId: account.id,
            metadataJson: { clientId: account.clientId, balance, currency: 'BRL' },
          },
        });
      } catch (error: any) {
        logger.error({ err: error, clientId: account.clientId, businessId: account.businessId, adAccountId: account.id }, 'Falha ao enviar alerta de saldo por WhatsApp.');
        await prisma.auditLog.create({
          data: {
            organizationId: account.organizationId,
            businessId: account.businessId,
            action: 'WHATSAPP_LOW_BALANCE_FAILED',
            entity: 'MetaAdAccount',
            entityId: account.id,
            metadataJson: { clientId: account.clientId, error: String(error?.message || 'Falha no envio') },
          },
        });
      }
    } catch (error) {
      logger.warn({ err: error, clientId: account.clientId, businessId: account.businessId, adAccountId: account.id }, 'Não foi possível verificar o saldo de uma conta Meta; as demais continuam sendo verificadas.');
    }
  }
}

async function dailySummaryCheck(logger: FastifyBaseLogger, now = new Date()) {
  if (!shouldSendDailySummary(now)) return;
  const clock = localClock(now);
  const periodStart = new Date(`${clock.date}T00:00:00.000Z`);
  const periodEnd = new Date(`${clock.date}T23:59:59.999Z`);

  const managers = await prisma.businessManager.findMany({
    where: { status: 'active' },
    include: {
      client: { select: { id: true, name: true, phone: true } },
      adAccounts: {
        where: { isActive: true, isAssigned: true },
        select: { id: true },
      },
    },
    orderBy: [{ clientId: 'asc' }, { name: 'asc' }],
  });

  for (const manager of managers) {
    if (!manager.adAccounts.length) continue;
    const sent = await prisma.auditLog.findFirst({
      where: {
        organizationId: manager.organizationId,
        businessId: manager.metaBusinessId,
        action: 'WHATSAPP_DAILY_SUMMARY_SENT',
        createdAt: { gte: new Date(Date.now() - 36 * 60 * 60 * 1000) },
        metadataJson: { path: ['date'], equals: clock.date },
      },
      select: { id: true },
    });
    if (sent) continue;

    if (!(await canSendForClient({ organizationId: manager.organizationId, clientId: manager.clientId, businessId: manager.metaBusinessId, phone: manager.client.phone }))) continue;

    const aggregate = await prisma.insightDaily.aggregate({
      where: {
        organizationId: manager.organizationId,
        clientId: manager.clientId,
        adAccountId: { in: manager.adAccounts.map((item) => item.id) },
        level: 'campaign',
        date: { gte: periodStart, lte: periodEnd },
      },
      _sum: { spend: true, conversations: true, impressions: true, reach: true },
    });
    const text = buildDailySummaryMessage({
      companyName: manager.client.name,
      businessName: manager.name,
      spend: Number(aggregate._sum.spend || 0),
      conversations: Number(aggregate._sum.conversations || 0),
      impressions: Number(aggregate._sum.impressions || 0),
      reach: Number(aggregate._sum.reach || 0),
    });

    try {
      await sendWhatsApp(manager.client.phone!, text);
      await prisma.auditLog.create({
        data: {
          organizationId: manager.organizationId,
          businessId: manager.metaBusinessId,
          action: 'WHATSAPP_DAILY_SUMMARY_SENT',
          entity: 'BusinessManager',
          entityId: manager.id,
          metadataJson: { clientId: manager.clientId, date: clock.date },
        },
      });
    } catch (error: any) {
      logger.error({ err: error, clientId: manager.clientId, businessId: manager.metaBusinessId }, 'Falha ao enviar resumo diário por WhatsApp.');
      await prisma.auditLog.create({
        data: {
          organizationId: manager.organizationId,
          businessId: manager.metaBusinessId,
          action: 'WHATSAPP_DAILY_SUMMARY_FAILED',
          entity: 'BusinessManager',
          entityId: manager.id,
          metadataJson: { clientId: manager.clientId, date: clock.date, error: String(error?.message || 'Falha no envio') },
        },
      });
    }
  }
}

export function startNotificationScheduler(logger: FastifyBaseLogger) {
  if (env.demoMode) {
    logger.info('Alertas financeiros e resumo WhatsApp desativados porque DEMO_MODE=true.');
    return () => undefined;
  }

  let running = false;
  let stopped = false;
  let lastBalanceSlot = '';

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const clock = localClock();
      const slot = `${clock.date}-${clock.hour}-${Math.floor(clock.minute / 5)}`;
      if (slot !== lastBalanceSlot) {
        lastBalanceSlot = slot;
        await lowBalanceCheck(logger);
      }
      await dailySummaryCheck(logger);
    } catch (error) {
      logger.error({ err: error }, 'Falha no ciclo de alertas automáticos.');
    } finally {
      running = false;
    }
  }

  const initialTimer = setTimeout(() => { void tick(); }, 45_000);
  const intervalTimer = setInterval(() => { void tick(); }, 60_000);
  logger.info('Alertas de saldo Meta configurados a cada 5 minutos e resumo WhatsApp por BM ao fim do dia (23:55, horário de Brasília).');

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
