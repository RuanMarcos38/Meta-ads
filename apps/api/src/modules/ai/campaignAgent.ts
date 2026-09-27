import axios from 'axios';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '../../config/env.js';
import { MetaAdsService } from '../meta/MetaAdsService.js';
import { sendWhatsAppOncePerDay } from '../notifications/notificationScheduler.js';
import { decrypt } from '../../shared/crypto.js';
import { prisma } from '../../shared/prisma.js';

const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'AGENCY_ADMIN']);

type MetricTotals = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  conversations: number;
  purchases: number;
  revenue: number;
};

type CampaignHealth = {
  campaignId: string;
  campaignName: string;
  businessId?: string | null;
  businessName?: string | null;
  score: number;
  status: 'excellent' | 'good' | 'attention' | 'critical';
  issues: string[];
  metrics: ReturnType<typeof decorateMetrics>;
};

function number(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function integer(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
}

function decimal(value: number, digits = 2) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function emptyTotals(): MetricTotals {
  return { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, conversations: 0, purchases: 0, revenue: 0 };
}

function addMetric(target: MetricTotals, row: any) {
  target.spend += number(row.spend);
  target.impressions += number(row.impressions);
  target.reach += number(row.reach);
  target.clicks += number(row.clicks);
  target.leads += number(row.leads);
  target.conversations += number(row.conversations);
  target.purchases += number(row.purchases);
  target.revenue += number(row.revenue);
}

function decorateMetrics(t: MetricTotals) {
  return {
    ...t,
    ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0,
    cpc: t.clicks ? t.spend / t.clicks : 0,
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : 0,
    frequency: t.reach ? t.impressions / t.reach : 0,
    costPerLead: t.leads ? t.spend / t.leads : 0,
    costPerConversation: t.conversations ? t.spend / t.conversations : 0,
    costPerPurchase: t.purchases ? t.spend / t.purchases : 0,
    roas: t.spend ? t.revenue / t.spend : 0,
  };
}

function saoPauloClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const val = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value || '';
  return {
    date: `${val('year')}-${val('month')}-${val('day')}`,
    hour: Number(val('hour') || 0),
    minute: Number(val('minute') || 0),
  };
}

function dateDaysAgo(days: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function healthStatus(score: number): CampaignHealth['status'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'attention';
  return 'critical';
}

export function evaluateCampaignHealth(
  campaign: { metaCampaignId: string; name: string; status?: string | null; effectiveStatus?: string | null },
  metrics: ReturnType<typeof decorateMetrics>,
  previous?: ReturnType<typeof decorateMetrics>,
): CampaignHealth {
  let score = 100;
  const issues: string[] = [];
  const active = (campaign.effectiveStatus || campaign.status || '').toUpperCase() === 'ACTIVE';

  if (active && metrics.impressions === 0) {
    score -= 45;
    issues.push('Campanha ativa sem entrega/impressões no período.');
  }
  if (metrics.impressions >= 800 && metrics.ctr < 0.7) {
    score -= 25;
    issues.push(`CTR baixo (${decimal(metrics.ctr)}%), indicando baixa resposta ao anúncio ou desalinhamento de público/criativo.`);
  } else if (metrics.impressions >= 800 && metrics.ctr < 1) {
    score -= 12;
    issues.push(`CTR em atenção (${decimal(metrics.ctr)}%).`);
  }
  if (metrics.frequency >= 4) {
    score -= 18;
    issues.push(`Frequência alta (${decimal(metrics.frequency)}), com possível saturação do criativo.`);
  } else if (metrics.frequency >= 3) {
    score -= 8;
    issues.push(`Frequência crescente (${decimal(metrics.frequency)}).`);
  }
  if (metrics.spend >= 50 && metrics.conversations === 0 && metrics.leads === 0 && metrics.purchases === 0) {
    score -= 25;
    issues.push('Há investimento relevante sem geração de conversas, leads ou compras.');
  }
  if (previous && previous.spend > 0 && metrics.costPerConversation > 0 && previous.costPerConversation > 0) {
    const delta = (metrics.costPerConversation - previous.costPerConversation) / previous.costPerConversation;
    if (delta >= 0.3) {
      score -= 15;
      issues.push(`Custo por conversa subiu ${decimal(delta * 100, 0)}% em relação ao período anterior.`);
    }
  }
  if (metrics.spend > 0 && metrics.roas > 0 && metrics.roas < 1) {
    score -= 15;
    issues.push(`ROAS abaixo de 1,00x (${decimal(metrics.roas)}x).`);
  }
  if (!issues.length && metrics.impressions > 0) {
    issues.push('Sem sinais críticos nas métricas observadas neste período.');
  }

  score = Math.max(0, Math.min(100, score));
  return {
    campaignId: campaign.metaCampaignId,
    campaignName: campaign.name,
    score,
    status: healthStatus(score),
    issues,
    metrics,
  };
}

async function loadCampaignHealthForClient(organizationId: string, clientId: string) {
  const since = dateDaysAgo(6);
  const previousSince = dateDaysAgo(13);
  const previousUntil = dateDaysAgo(7);

  const [campaigns, currentRows, previousRows] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId, clientId },
      select: {
        metaCampaignId: true,
        name: true,
        status: true,
        effectiveStatus: true,
        adAccount: { select: { businessId: true, businessName: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.insightDaily.findMany({
      where: {
        organizationId,
        clientId,
        level: 'campaign',
        date: { gte: since },
      },
      select: {
        campaignId: true,
        spend: true,
        impressions: true,
        reach: true,
        clicks: true,
        leads: true,
        conversations: true,
        purchases: true,
        revenue: true,
      },
    }),
    prisma.insightDaily.findMany({
      where: {
        organizationId,
        clientId,
        level: 'campaign',
        date: { gte: previousSince, lte: previousUntil },
      },
      select: {
        campaignId: true,
        spend: true,
        impressions: true,
        reach: true,
        clicks: true,
        leads: true,
        conversations: true,
        purchases: true,
        revenue: true,
      },
    }),
  ]);

  const aggregate = (rows: any[]) => {
    const map = new Map<string, MetricTotals>();
    for (const row of rows) {
      if (!row.campaignId) continue;
      const total = map.get(row.campaignId) || emptyTotals();
      addMetric(total, row);
      map.set(row.campaignId, total);
    }
    return map;
  };

  const current = aggregate(currentRows);
  const previous = aggregate(previousRows);

  return campaigns.map((campaign) => {
    const metrics = decorateMetrics(current.get(campaign.metaCampaignId) || emptyTotals());
    const previousMetrics = decorateMetrics(previous.get(campaign.metaCampaignId) || emptyTotals());
    return {
      ...evaluateCampaignHealth(campaign, metrics, previousMetrics),
      businessId: campaign.adAccount.businessId,
      businessName: campaign.adAccount.businessName,
    };
  });
}

export async function refreshCampaignHealth(organizationId?: string) {
  const clients = await prisma.client.findMany({
    where: {
      status: 'active',
      ...(organizationId ? { organizationId } : {}),
    },
    select: { id: true, organizationId: true },
  });

  let processed = 0;
  for (const client of clients) {
    const health = await loadCampaignHealthForClient(client.organizationId, client.id);
    for (const item of health) {
      await prisma.aiCampaignHealth.upsert({
        where: {
          organizationId_clientId_campaignId: {
            organizationId: client.organizationId,
            clientId: client.id,
            campaignId: item.campaignId,
          },
        },
        update: {
          businessId: item.businessId || null,
          campaignName: item.campaignName,
          score: item.score,
          status: item.status,
          issuesJson: item.issues,
          metricsJson: item.metrics,
          analyzedAt: new Date(),
        },
        create: {
          organizationId: client.organizationId,
          clientId: client.id,
          businessId: item.businessId || null,
          campaignId: item.campaignId,
          campaignName: item.campaignName,
          score: item.score,
          status: item.status,
          issuesJson: item.issues,
          metricsJson: item.metrics,
          analyzedAt: new Date(),
        },
      });
      processed += 1;
    }
  }
  return processed;
}

function outputText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const chunks: string[] = [];
  for (const output of data?.output || []) {
    for (const part of output?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

async function callOpenAI(input: {
  system: string;
  user: string;
  images?: string[];
  maxOutputTokens?: number;
}) {
  if (!env.ai.apiKey) throw new Error('AI_NOT_CONFIGURED');
  const content: any[] = [{ type: 'input_text', text: input.user }];
  for (const image of input.images || []) content.push({ type: 'input_image', image_url: image });

  const response = await axios.post('https://api.openai.com/v1/responses', {
    model: env.ai.model,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: input.system }] },
      { role: 'user', content },
    ],
    max_output_tokens: input.maxOutputTokens || 900,
  }, {
    headers: {
      authorization: `Bearer ${env.ai.apiKey}`,
      'content-type': 'application/json',
    },
    timeout: 45_000,
  });

  const text = outputText(response.data);
  if (!text) throw new Error('AI_EMPTY_RESPONSE');
  return text;
}

export function wantsHumanHandoff(text: string) {
  const normalized = text.toLowerCase();
  return [
    /falar com (o |a )?(gestor|humano|atendente|pessoa|especialista)/,
    /quero (um |uma )?(gestor|humano|atendente|pessoa)/,
    /me passa (pro|pra|para)( o| a| um| uma)? (gestor|humano|atendente|pessoa|especialista)/,
    /chama (o |a )?(gestor|humano|atendente)/,
    /preciso (do|da|de um|de uma) (gestor|humano|atendente)/,
    /não quero (falar com )?(a )?i[.a]?/,
  ].some((pattern) => pattern.test(normalized));
}

function wantsCreativeAnalysis(text: string) {
  return /(criativ|anúncio|anuncio|imagem|vídeo|video|copy|ctr|thumb|arte)/i.test(text);
}

async function fetchImageAsDataUrl(url?: string | null) {
  if (!url) return null;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 12_000,
      maxContentLength: 2 * 1024 * 1024,
    });
    const type = String(response.headers['content-type'] || 'image/jpeg').split(';')[0];
    if (!type.startsWith('image/')) return null;
    return `data:${type};base64,${Buffer.from(response.data).toString('base64')}`;
  } catch {
    return null;
  }
}

async function creativeContext(organizationId: string, clientId: string) {
  const since = dateDaysAgo(13);
  const rows = await prisma.insightDaily.findMany({
    where: { organizationId, clientId, level: 'ad', date: { gte: since }, adId: { not: null } },
    select: { adId: true, spend: true, impressions: true, clicks: true, conversations: true, leads: true },
  });
  const map = new Map<string, MetricTotals>();
  for (const row of rows) {
    if (!row.adId) continue;
    const total = map.get(row.adId) || emptyTotals();
    addMetric(total, row);
    map.set(row.adId, total);
  }
  const ranked = Array.from(map.entries())
    .map(([adId, totals]) => ({ adId, metrics: decorateMetrics(totals) }))
    .sort((a, b) => b.metrics.spend - a.metrics.spend)
    .slice(0, 3);

  const ads = ranked.length ? await prisma.ad.findMany({
    where: { metaAdId: { in: ranked.map((item) => item.adId) } },
    select: {
      metaAdId: true,
      name: true,
      creativeId: true,
      adSet: {
        select: {
          campaign: {
            select: {
              name: true,
              adAccount: {
                select: {
                  accountId: true,
                  businessId: true,
                  businessName: true,
                  connection: { select: { accessTokenEncrypted: true, status: true } },
                },
              },
            },
          },
        },
      },
    },
  }) : [];

  const byId = new Map(ads.map((ad) => [ad.metaAdId, ad]));
  const details: any[] = [];
  const images: string[] = [];

  for (const rankedAd of ranked) {
    const ad = byId.get(rankedAd.adId);
    if (!ad) continue;
    let creative: any = null;
    if (ad.creativeId && ad.adSet.campaign.adAccount.connection.status === 'active') {
      try {
        const meta = new MetaAdsService(decrypt(ad.adSet.campaign.adAccount.connection.accessTokenEncrypted));
        creative = await meta.creativeDetails(ad.creativeId);
        const dataUrl = await fetchImageAsDataUrl(creative?.thumbnail_url || creative?.image_url);
        if (dataUrl && images.length < 2) images.push(dataUrl);
      } catch {
        creative = null;
      }
    }
    details.push({
      ad: ad.name,
      campaign: ad.adSet.campaign.name,
      business: ad.adSet.campaign.adAccount.businessName || ad.adSet.campaign.adAccount.businessId,
      metrics: rankedAd.metrics,
      creative: creative ? {
        name: creative.name || null,
        title: creative.title || null,
        body: creative.body || null,
        hasImage: Boolean(creative.image_url || creative.thumbnail_url),
      } : null,
    });
  }

  return { details, images };
}

async function clientContext(organizationId: string, clientId: string) {
  const [client, managers, health] = await Promise.all([
    prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { id: true, name: true, companyName: true, segment: true },
    }),
    prisma.businessManager.findMany({
      where: { organizationId, clientId, status: 'active' },
      select: { metaBusinessId: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.aiCampaignHealth.findMany({
      where: { organizationId, clientId },
      orderBy: [{ score: 'asc' }, { campaignName: 'asc' }],
      take: 40,
    }),
  ]);
  if (!client) throw new Error('CLIENT_NOT_FOUND');

  if (!health.length) await refreshCampaignHealth(organizationId);
  const currentHealth = health.length ? health : await prisma.aiCampaignHealth.findMany({
    where: { organizationId, clientId },
    orderBy: [{ score: 'asc' }, { campaignName: 'asc' }],
    take: 40,
  });

  return {
    client,
    managers,
    campaigns: currentHealth.map((item) => ({
      campaign: item.campaignName,
      bm: managers.find((manager) => manager.metaBusinessId === item.businessId)?.name || item.businessId || 'BM não identificada',
      score: item.score,
      status: item.status,
      issues: Array.isArray(item.issuesJson) ? item.issuesJson : [],
      metrics: item.metricsJson,
      analyzedAt: item.analyzedAt,
    })),
  };
}

async function getOrCreateAiUser(organizationId: string) {
  const email = `assistente-ia+${organizationId}@system.r2r.local`;
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      name: 'Assistente IA de Campanhas',
      email,
      passwordHash: 'SYSTEM_AI_ACCOUNT_NO_LOGIN',
      role: 'AGENCY_ADMIN',
      organizationId,
      isActive: false,
      mustChangePassword: false,
    },
    select: { id: true },
  });
  return created.id;
}

async function recentConversation(conversationId: string) {
  const messages = await prisma.supportMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { senderId: true, body: true, createdAt: true },
  });
  return messages.reverse().map((m) => ({
    senderId: m.senderId,
    body: m.body || '',
    at: m.createdAt.toISOString(),
  }));
}

function supportSystemPrompt() {
  return [
    'Você é o Assistente IA de Campanhas da plataforma Gestão Ads.',
    'Atenda em português do Brasil, de forma humana, clara, objetiva e consultiva.',
    'Use SOMENTE os dados da empresa fornecidos no contexto. Nunca misture dados de empresas, BMs ou contas diferentes.',
    'Sempre deixe claro o período e a BM quando citar métricas.',
    'Não invente números, disponibilidade, configurações ou ações executadas.',
    'Diferencie observação de recomendação. CTR, CPM, frequência, CPL, custo por conversa e ROAS dependem de objetivo, público, criativo e histórico.',
    'Quando houver sinais ruins, explique causas prováveis e quais verificações o gestor deve fazer, sem afirmar causalidade sem evidência.',
    'Se houver análise visual de criativo, considere mensagem, clareza, oferta, contraste, hierarquia, adequação ao objetivo e relação com CTR/frequência.',
    'Responda também dúvidas de uso da ferramenta e interpretação das métricas.',
    'Não altere campanhas por conta própria. Sua função é analisar, explicar e orientar.',
    'Se o cliente pedir gestor de tráfego, humano ou atendente, não tente convencê-lo a continuar com a IA.',
    'Evite textos gigantes: prefira resposta útil em até 3 blocos curtos, salvo se o cliente pedir detalhes.',
  ].join('\n');
}

export async function handleSupportMessageWithAi(input: {
  conversationId: string;
  senderUserId: string;
  text: string;
  logger?: FastifyBaseLogger;
}) {
  const [conversation, sender] = await Promise.all([
    prisma.supportConversation.findUnique({ where: { id: input.conversationId } }),
    prisma.user.findUnique({ where: { id: input.senderUserId }, select: { id: true, role: true, organizationId: true, clientId: true } }),
  ]);
  if (!conversation || !sender?.organizationId || !sender.clientId) return;
  if (conversation.type !== 'CHAT' || !conversation.aiEnabled || ADMIN_ROLES.has(sender.role)) return;

  if (wantsHumanHandoff(input.text)) {
    await prisma.supportConversation.update({
      where: { id: conversation.id },
      data: { aiEnabled: false, humanHandoffAt: new Date(), status: 'PENDING' },
    });
    await prisma.alert.create({
      data: {
        organizationId: sender.organizationId,
        clientId: sender.clientId,
        type: 'AI_HUMAN_HANDOFF_REQUESTED',
        severity: 'warning',
        title: 'Cliente solicitou gestor de tráfego',
        message: 'A IA foi desativada nesta conversa. O cliente aguarda atendimento humano.',
      },
    }).catch(() => undefined);
    return;
  }

  if (!env.ai.apiKey) {
    await prisma.supportConversation.update({
      where: { id: conversation.id },
      data: { aiEnabled: false, humanHandoffAt: new Date(), status: 'PENDING' },
    });
    await prisma.alert.create({
      data: {
        organizationId: sender.organizationId,
        clientId: sender.clientId,
        type: 'AI_CONFIGURATION_REQUIRED',
        severity: 'warning',
        title: 'Agente IA aguardando configuração',
        message: 'Configure OPENAI_API_KEY no EasyPanel. Enquanto isso, a conversa foi encaminhada ao atendimento humano.',
      },
    }).catch(() => undefined);
    return;
  }

  const [context, history] = await Promise.all([
    clientContext(sender.organizationId, sender.clientId),
    recentConversation(conversation.id),
  ]);
  const creative = wantsCreativeAnalysis(input.text)
    ? await creativeContext(sender.organizationId, sender.clientId)
    : { details: [], images: [] as string[] };

  const userPrompt = [
    `Empresa: ${context.client.name}${context.client.companyName ? ` / ${context.client.companyName}` : ''}`,
    `BMs autorizadas: ${context.managers.map((m) => m.name).join(', ') || 'nenhuma'}`,
    '',
    'Saúde das campanhas (últimos 7 dias, calculada pela plataforma):',
    JSON.stringify(context.campaigns, null, 2),
    creative.details.length ? '\nCriativos/anúncios de maior investimento (últimos 14 dias):\n' + JSON.stringify(creative.details, null, 2) : '',
    '\nHistórico recente do atendimento:',
    JSON.stringify(history, null, 2),
    '\nPergunta atual do cliente:',
    input.text,
  ].filter(Boolean).join('\n');

  const answer = await callOpenAI({
    system: supportSystemPrompt(),
    user: userPrompt,
    images: creative.images,
    maxOutputTokens: 850,
  });

  const aiUserId = await getOrCreateAiUser(sender.organizationId);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const current = await tx.supportConversation.findUnique({
      where: { id: conversation.id },
      select: { aiEnabled: true, humanHandoffAt: true },
    });
    if (!current?.aiEnabled || current.humanHandoffAt) return;

    await tx.supportMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: aiUserId,
        kind: 'TEXT',
        body: answer,
      },
    });
    await tx.supportConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        aiLastReplyAt: now,
        firstResponseAt: conversation.firstResponseAt || now,
      },
    });
  });
}

function compactCampaignLine(item: any) {
  const m = item.metricsJson as any || {};
  const issues = Array.isArray(item.issuesJson) ? item.issuesJson.slice(0, 2).join(' | ') : '';
  return `${item.campaignName} [${item.status}/${item.score}] — Invest. ${money(number(m.spend))}; CTR ${decimal(number(m.ctr))}%; CPC ${money(number(m.cpc))}; Conv. ${integer(number(m.conversations))}; Custo/conv. ${money(number(m.costPerConversation))}; Freq. ${decimal(number(m.frequency))}; ROAS ${decimal(number(m.roas))}x${issues ? `; sinais: ${issues}` : ''}`;
}

async function organizationReportContext(organizationId: string) {
  const clients = await prisma.client.findMany({
    where: { organizationId, status: 'active' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  const health = await prisma.aiCampaignHealth.findMany({
    where: { organizationId },
    orderBy: [{ clientId: 'asc' }, { score: 'asc' }],
  });
  const managers = await prisma.businessManager.findMany({
    where: { organizationId, status: 'active' },
    select: { clientId: true, metaBusinessId: true, name: true },
  });
  const managerMap = new Map(managers.map((m) => [`${m.clientId}:${m.metaBusinessId}`, m.name]));

  return clients.map((client) => {
    const campaigns = health.filter((h) => h.clientId === client.id);
    const critical = campaigns.filter((h) => h.status === 'critical' || h.status === 'attention');
    return {
      client: client.name,
      campaignCount: campaigns.length,
      attentionCount: critical.length,
      campaigns: campaigns.slice(0, 8).map((h) => ({
        bm: managerMap.get(`${client.id}:${h.businessId || ''}`) || h.businessId || 'BM não identificada',
        line: compactCampaignLine(h),
      })),
    };
  });
}

function fallbackAdminReport(context: Awaited<ReturnType<typeof organizationReportContext>>, date: string) {
  const lines = [
    `📊 *Análise diária IA — Gestão Ads — ${date}*`,
    '',
    `Clientes analisados: ${context.length}`,
  ];
  for (const client of context) {
    lines.push('', `🏢 *${client.client}* — ${client.campaignCount} campanha(s), ${client.attentionCount} em atenção`);
    for (const campaign of client.campaigns.slice(0, 3)) {
      lines.push(`• ${campaign.bm}: ${campaign.line}`);
    }
  }
  lines.push('', 'Priorize campanhas críticas, CTR baixo, frequência alta e aumento de custo por conversa. Consulte a ferramenta para o diagnóstico completo por BM.');
  return lines.join('\n').slice(0, 3900);
}

async function buildAiAdminReport(organizationId: string, date: string) {
  const context = await organizationReportContext(organizationId);
  if (!env.ai.apiKey) return fallbackAdminReport(context, date);

  const visualCandidates = context
    .filter((item) => item.attentionCount > 0)
    .slice(0, 4);
  const creativeReviews: any[] = [];
  const images: string[] = [];

  for (const item of visualCandidates) {
    const client = await prisma.client.findFirst({
      where: { organizationId, name: item.client, status: 'active' },
      select: { id: true },
    });
    if (!client) continue;
    try {
      const creative = await creativeContext(organizationId, client.id);
      creativeReviews.push({
        client: item.client,
        creatives: creative.details.slice(0, 2),
      });
      for (const image of creative.images) {
        if (images.length < 4) images.push(image);
      }
    } catch {
      // A análise de métricas continua mesmo se um criativo não puder ser carregado na Meta.
    }
  }

  const prompt = [
    `Data local: ${date}`,
    'Produza um relatório executivo diário PRIVADO para o administrador da agência.',
    'Analise todos os clientes e BMs separadamente. Nunca misture números entre clientes.',
    'Pense como gestor de tráfego sênior de alta performance: destaque risco, oportunidade, provável causa e ação prioritária.',
    'Use no máximo 3 pontos por cliente e finalize com as 5 prioridades gerais do dia.',
    'Se uma causa não puder ser comprovada pelos dados, trate como hipótese e diga o que verificar.',
    'Para os criativos fornecidos, faça análise visual quando houver imagem: clareza, oferta, hierarquia, legibilidade, adequação ao objetivo e relação com CTR/frequência.',
    'Não chame um criativo de ruim apenas por CTR baixo; diferencie evidência visual, hipótese de público/oferta e problema de entrega.',
    'Texto para WhatsApp, direto, profissional, sem tabelas, até 3.800 caracteres.',
    '',
    'Carteira de campanhas:',
    JSON.stringify(context, null, 2),
    creativeReviews.length ? '\nCriativos carregados diretamente da Meta para revisão:\n' + JSON.stringify(creativeReviews, null, 2) : '',
  ].filter(Boolean).join('\n');

  try {
    const generated = await callOpenAI({
      system: 'Você é um gestor de tráfego sênior responsável pela análise privada de uma carteira de clientes. Seja técnico, criterioso, orientado a evidências e objetivo.',
      user: prompt,
      images,
      maxOutputTokens: 1500,
    });
    return generated.slice(0, 3900);
  } catch {
    return fallbackAdminReport(context, date);
  }
}

async function sendDailyAdminReport(logger: FastifyBaseLogger) {
  const clock = saoPauloClock();
  if (clock.hour < env.ai.dailyReportHour) return;

  const platformAdmin = await prisma.user.findFirst({
    where: {
      role: 'SUPER_ADMIN',
      isActive: true,
      organizationId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true },
  });
  const organizationId = platformAdmin?.organizationId;
  if (!organizationId) return;

  try {
    const text = await buildAiAdminReport(organizationId, clock.date);
    const delivery = await sendWhatsAppOncePerDay({
      organizationId,
      clientId: organizationId,
      phone: env.ai.adminWhatsapp,
      text,
      reason: 'AI_ADMIN_DAILY_REPORT',
    });
    if (delivery.sent) {
      await prisma.auditLog.create({
        data: {
          organizationId,
          action: 'AI_ADMIN_DAILY_REPORT_SENT',
          entity: 'Organization',
          entityId: organizationId,
          metadataJson: { date: clock.date, phone: env.ai.adminWhatsapp, privateAdminOnly: true },
        },
      });
    }
  } catch (error) {
    logger.error({ err: error, organizationId }, 'Falha ao enviar relatório diário privado da IA.');
  }
}

export function startAiCampaignScheduler(logger: FastifyBaseLogger) {
  if (env.demoMode) {
    logger.info('Agente IA de campanhas desativado porque DEMO_MODE=true.');
    return () => undefined;
  }

  const intervalMs = env.ai.analysisIntervalMinutes * 60 * 1000;
  let running = false;
  let stopped = false;

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const processed = await refreshCampaignHealth();
      logger.info({ processed }, 'Análise contínua de saúde das campanhas atualizada.');
      await sendDailyAdminReport(logger);
    } catch (error) {
      logger.error({ err: error }, 'Falha no ciclo do agente IA de campanhas.');
    } finally {
      running = false;
    }
  }

  const initialTimer = setTimeout(() => { void tick(); }, 60_000);
  const intervalTimer = setInterval(() => { void tick(); }, intervalMs);
  logger.info(`Agente IA: análise contínua a cada ${env.ai.analysisIntervalMinutes} minuto(s); relatório privado diário após ${env.ai.dailyReportHour}:00 (Brasília).`);

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}

export async function aiStatusForOrganization(organizationId: string) {
  const latest = await prisma.aiCampaignHealth.findFirst({
    where: { organizationId },
    orderBy: { analyzedAt: 'desc' },
    select: { analyzedAt: true },
  });
  return {
    configured: Boolean(env.ai.apiKey),
    model: env.ai.model,
    continuousAnalysis: true,
    intervalMinutes: env.ai.analysisIntervalMinutes,
    dailyAdminReport: true,
    dailyReportHour: env.ai.dailyReportHour,
    adminWhatsapp: env.ai.adminWhatsapp ? `***${env.ai.adminWhatsapp.slice(-4)}` : null,
    lastAnalysisAt: latest?.analyzedAt || null,
  };
}
