import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import dayjs from 'dayjs';
import { prisma } from './shared/prisma.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';
import { decrypt } from './shared/crypto.js';
import { MetaAdsService, type MetaBreakdown, type MetaInsightLevel } from './modules/meta/MetaAdsService.js';
import { mapMetaActions, mapMetaActionValues } from './modules/meta/metaActions.js';

const breakdowns = ['age', 'gender', 'region', 'publisher_platform', 'device_platform', 'platform_position'] as const;
const levels = ['campaign', 'adset', 'ad'] as const;
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const tenantRoles = new Set(['CLIENT', 'MANAGER']);

function businessScope(user: AuthUser, requested?: string) {
  if (tenantRoles.has(user.role)) return user.businessId || '__NO_BUSINESS__';
  return requested;
}

export async function registerBreakdownRoutes(app: FastifyInstance) {
  app.get('/performance/breakdowns', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({
      clientId: z.string().uuid().optional(),
      businessId: z.string().optional(),
      adAccountId: z.string().uuid().optional(),
      campaignId: z.string().optional(),
      adSetId: z.string().optional(),
      adId: z.string().optional(),
      since: dateText.optional(),
      until: dateText.optional(),
      type: z.enum(breakdowns),
      level: z.enum(levels).default('campaign'),
    }).safeParse(req.query);
    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Filtros de detalhamento inválidos.'));

    const clientId = scopeClient(user, query.data.clientId);
    const businessId = businessScope(user, query.data.businessId);
    if (!clientId) return reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa.'));
    if (businessId === '__NO_BUSINESS__') return reply.code(403).send(fail('BUSINESS_REQUIRED', 'Este usuário precisa estar vinculado a uma BM.'));

    const accounts = await prisma.metaAdAccount.findMany({
      where: {
        organizationId: user.organizationId!, clientId, isActive: true, isAssigned: true,
        ...(businessId ? { businessId } : {}),
        ...(query.data.adAccountId ? { id: query.data.adAccountId } : {}),
      },
      select: { id: true },
    });
    const accountIds = accounts.map((item) => item.id);
    const since = query.data.since || dayjs().subtract(29, 'day').format('YYYY-MM-DD');
    const until = query.data.until || dayjs().format('YYYY-MM-DD');
    const rows = accountIds.length ? await prisma.insightBreakdownDaily.findMany({
      where: {
        organizationId: user.organizationId!, clientId, adAccountId: { in: accountIds },
        breakdownType: query.data.type, level: query.data.level,
        date: { gte: new Date(`${since}T00:00:00.000Z`), lte: new Date(`${until}T23:59:59.999Z`) },
        ...(query.data.campaignId ? { campaignId: query.data.campaignId } : {}),
        ...(query.data.adSetId ? { adSetId: query.data.adSetId } : {}),
        ...(query.data.adId ? { adId: query.data.adId } : {}),
      },
      orderBy: { date: 'asc' },
    }) : [];

    const grouped = new Map<string, { value: string; spend: number; impressions: number; reach: number; clicks: number; leads: number; conversations: number; purchases: number; revenue: number }>();
    for (const row of rows) {
      const current = grouped.get(row.breakdownValue) || { value: row.breakdownValue, spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, conversations: 0, purchases: 0, revenue: 0 };
      current.spend += Number(row.spend || 0);
      current.impressions += row.impressions;
      current.reach += row.reach;
      current.clicks += row.clicks;
      current.leads += row.leads;
      current.conversations += row.conversations;
      current.purchases += row.purchases;
      current.revenue += Number(row.revenue || 0);
      grouped.set(row.breakdownValue, current);
    }

    const data = Array.from(grouped.values()).map((row) => ({
      ...row,
      ctr: row.impressions ? row.clicks / row.impressions * 100 : 0,
      cpc: row.clicks ? row.spend / row.clicks : 0,
      cpm: row.impressions ? row.spend / row.impressions * 1000 : 0,
      cpl: row.leads ? row.spend / row.leads : 0,
      cpa: row.purchases ? row.spend / row.purchases : 0,
      roas: row.spend ? row.revenue / row.spend : 0,
    })).sort((a, b) => b.spend - a.spend);

    return ok({ type: query.data.type, level: query.data.level, since, until, rows: data });
  });

  app.post('/performance/breakdowns/sync', { preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN', 'MANAGER']) }, async (req, reply) => {
    const user = req.user as AuthUser;
    const body = z.object({
      clientId: z.string().uuid().optional(),
      businessId: z.string().optional(),
      adAccountId: z.string().uuid().optional(),
      since: dateText,
      until: dateText,
      types: z.array(z.enum(breakdowns)).min(1).max(breakdowns.length).default([...breakdowns]),
      level: z.enum(levels).default('campaign'),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(fail('VALIDATION', 'Parâmetros de detalhamento inválidos.'));

    const clientId = scopeClient(user, body.data.clientId);
    const businessId = businessScope(user, body.data.businessId);
    if (!clientId) return reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa.'));
    if (businessId === '__NO_BUSINESS__') return reply.code(403).send(fail('BUSINESS_REQUIRED', 'Este usuário precisa estar vinculado a uma BM.'));

    const accounts = await prisma.metaAdAccount.findMany({
      where: {
        organizationId: user.organizationId!, clientId, isActive: true, isAssigned: true,
        ...(businessId ? { businessId } : {}),
        ...(body.data.adAccountId ? { id: body.data.adAccountId } : {}),
      },
      include: { connection: true },
    });
    if (!accounts.length) return reply.code(409).send(fail('NO_ASSIGNED_META_ACCOUNTS', 'Nenhuma conta Meta autorizada neste escopo.'));

    let processed = 0;
    const errors: Array<{ accountId: string; type: string; message: string }> = [];
    for (const account of accounts) {
      if (account.connection.status !== 'active') continue;
      const meta = new MetaAdsService(decrypt(account.connection.accessTokenEncrypted));
      const actId = account.accountId.startsWith('act_') ? account.accountId : `act_${account.accountId}`;
      for (const type of body.data.types as MetaBreakdown[]) {
        try {
          const insights = await meta.breakdownInsights(actId, body.data.since, body.data.until, type, body.data.level as MetaInsightLevel);
          for (const insight of insights) {
            const mapped = mapMetaActions(insight.actions);
            const values = mapMetaActionValues(insight.action_values);
            const campaignId = String(insight.campaign_id || '');
            const adSetId = body.data.level === 'campaign' ? '' : String(insight.adset_id || '');
            const adId = body.data.level === 'ad' ? String(insight.ad_id || '') : '';
            const value = String(insight[type] ?? 'Não informado');
            if (!campaignId || !value) continue;
            await prisma.insightBreakdownDaily.upsert({
              where: {
                level_date_adAccountId_campaignId_adSetId_adId_breakdownType_breakdownValue: {
                  level: body.data.level,
                  date: new Date(insight.date_start),
                  adAccountId: account.id,
                  campaignId,
                  adSetId,
                  adId,
                  breakdownType: type,
                  breakdownValue: value,
                },
              },
              update: {
                spend: Number(insight.spend || 0), impressions: Number(insight.impressions || 0), reach: Number(insight.reach || 0), clicks: Number(insight.clicks || 0),
                leads: mapped.leads, conversations: mapped.conversations, purchases: mapped.purchases, revenue: values.purchaseValue,
              },
              create: {
                organizationId: user.organizationId!, clientId, adAccountId: account.id,
                campaignId, adSetId, adId, level: body.data.level, date: new Date(insight.date_start),
                breakdownType: type, breakdownValue: value,
                spend: Number(insight.spend || 0), impressions: Number(insight.impressions || 0), reach: Number(insight.reach || 0), clicks: Number(insight.clicks || 0),
                leads: mapped.leads, conversations: mapped.conversations, purchases: mapped.purchases, revenue: values.purchaseValue,
              },
            });
            processed += 1;
          }
        } catch (error: any) {
          errors.push({ accountId: account.accountId, type, message: error?.response?.data?.error?.message || error?.message || 'Falha da Meta' });
        }
      }
    }

    return ok({ processed, accounts: accounts.length, errors }, errors.length ? 'Detalhamentos sincronizados parcialmente.' : 'Detalhamentos sincronizados com sucesso.');
  });
}
