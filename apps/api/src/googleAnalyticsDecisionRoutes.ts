import type { FastifyInstance } from 'fastify';
import axios from 'axios';
import { z } from 'zod';
import { prisma } from './shared/prisma.js';
import { decrypt, encrypt } from './shared/crypto.js';
import { requireAuth, scopeClient, type AuthUser } from './shared/auth.js';
import { fail, ok } from './shared/response.js';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function googleConfig() {
  return {
    clientId: process.env.GOOGLE_ANALYTICS_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || '',
    clientSecret: process.env.GOOGLE_ANALYTICS_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || '',
  };
}

function googleErrorMessage(error: any) {
  return String(
    error?.response?.data?.error?.message
      || error?.response?.data?.error_description
      || error?.message
      || 'Falha ao consultar o Google Analytics.',
  );
}

async function ensureClient(user: AuthUser, requestedClientId: string | undefined, reply: any) {
  const clientId = scopeClient(user, requestedClientId);
  if (!clientId) {
    reply.code(400).send(fail('CLIENT_REQUIRED', 'Selecione uma empresa para consultar o Google Analytics.'));
    return null;
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: user.organizationId! },
    select: { id: true, name: true },
  });

  if (!client) {
    reply.code(404).send(fail('CLIENT_NOT_FOUND', 'Empresa não encontrada para este acesso.'));
    return null;
  }

  return client;
}

async function refreshAccessToken(connection: any) {
  const cfg = googleConfig();
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('Credenciais OAuth do Google Analytics não configuradas.');
  if (!connection.refreshTokenEncrypted) throw new Error('Token de renovação do Google Analytics ausente. Reconecte a conta Google.');

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: decrypt(connection.refreshTokenEncrypted),
    grant_type: 'refresh_token',
  });

  const response = await axios.post('https://oauth2.googleapis.com/token', body, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });

  const accessToken = String(response.data?.access_token || '');
  if (!accessToken) throw new Error('O Google não retornou um novo token de acesso.');

  const expiresIn = Number(response.data?.expires_in || 3600);
  const tokenExpiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000);

  await prisma.googleAnalyticsConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encrypt(accessToken),
      tokenExpiresAt,
      status: 'active',
      lastError: null,
    },
  });

  return accessToken;
}

async function accessToken(connection: any) {
  const validUntil = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : 0;
  if (connection.accessTokenEncrypted && validUntil > Date.now() + 60_000) {
    return decrypt(connection.accessTokenEncrypted);
  }
  return refreshAccessToken(connection);
}

async function runReport(token: string, propertyId: string, body: Record<string, unknown>) {
  const response = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    body,
    {
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      timeout: 25_000,
    },
  );
  return response.data;
}

async function runRealtimeReport(token: string, propertyId: string, body: Record<string, unknown>) {
  const response = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runRealtimeReport`,
    body,
    {
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      timeout: 20_000,
    },
  );
  return response.data;
}

function metricNumber(row: any, metricHeaders: any[], name: string) {
  const index = metricHeaders.findIndex((item: any) => item?.name === name);
  if (index < 0) return 0;
  const value = Number(row?.metricValues?.[index]?.value || 0);
  return Number.isFinite(value) ? value : 0;
}

function dimensionValue(row: any, dimensionHeaders: any[], name: string) {
  const index = dimensionHeaders.findIndex((item: any) => item?.name === name);
  return index < 0 ? '' : String(row?.dimensionValues?.[index]?.value || '');
}

function parseSummary(report: any) {
  const row = report?.rows?.[0] || {};
  const headers = report?.metricHeaders || [];
  return {
    sessions: metricNumber(row, headers, 'sessions'),
    totalUsers: metricNumber(row, headers, 'totalUsers'),
    newUsers: metricNumber(row, headers, 'newUsers'),
    engagedSessions: metricNumber(row, headers, 'engagedSessions'),
    engagementRate: metricNumber(row, headers, 'engagementRate'),
    keyEvents: metricNumber(row, headers, 'keyEvents'),
    totalRevenue: metricNumber(row, headers, 'totalRevenue'),
  };
}

function parseExtendedSummary(report: any) {
  const row = report?.rows?.[0] || {};
  const headers = report?.metricHeaders || [];
  return {
    bounceRate: metricNumber(row, headers, 'bounceRate'),
    averageSessionDuration: metricNumber(row, headers, 'averageSessionDuration'),
    screenPageViews: metricNumber(row, headers, 'screenPageViews'),
    screenPageViewsPerSession: metricNumber(row, headers, 'screenPageViewsPerSession'),
    eventCount: metricNumber(row, headers, 'eventCount'),
  };
}

function parseDimensionRows(report: any, dimensionNames: string[], metrics: string[]) {
  const dimensions = report?.dimensionHeaders || [];
  const metricHeaders = report?.metricHeaders || [];
  return (report?.rows || []).map((row: any) => ({
    ...Object.fromEntries(dimensionNames.map((name) => [name, dimensionValue(row, dimensions, name)])),
    ...Object.fromEntries(metrics.map((name) => [name, metricNumber(row, metricHeaders, name)])),
  }));
}

function formatIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function previousPeriod(since: string, until: string) {
  const start = new Date(`${since}T00:00:00.000Z`);
  const end = new Date(`${until}T00:00:00.000Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / dayMs) + 1);
  const previousUntil = new Date(start.getTime() - dayMs);
  const previousSince = new Date(previousUntil.getTime() - (days - 1) * dayMs);
  return { since: formatIso(previousSince), until: formatIso(previousUntil) };
}

export async function registerGoogleAnalyticsDecisionRoutes(app: FastifyInstance) {
  app.get('/google-analytics/decision-report', { preHandler: requireAuth() }, async (req, reply) => {
    const user = req.user as AuthUser;
    const query = z.object({
      clientId: z.string().uuid().optional(),
      since: dateText,
      until: dateText,
    }).safeParse(req.query);

    if (!query.success) return reply.code(400).send(fail('VALIDATION', 'Empresa ou período inválido.'));
    if (query.data.since > query.data.until) return reply.code(400).send(fail('VALIDATION', 'A data inicial precisa ser anterior à data final.'));

    const client = await ensureClient(user, query.data.clientId, reply);
    if (!client) return;

    const connection = await prisma.googleAnalyticsConnection.findUnique({
      where: { organizationId_clientId: { organizationId: user.organizationId!, clientId: client.id } },
    });

    if (!connection || connection.status !== 'active') {
      return reply.code(409).send(fail('GOOGLE_ANALYTICS_CONNECTION_REQUIRED', 'O Google Analytics desta empresa não está conectado.'));
    }
    if (!connection.propertyId) {
      return reply.code(409).send(fail('GOOGLE_ANALYTICS_PROPERTY_REQUIRED', 'Selecione a propriedade GA4 desta empresa antes de consultar os resultados.'));
    }

    try {
      const token = await accessToken(connection);
      const dateRanges = [{ startDate: query.data.since, endDate: query.data.until }];
      const previous = previousPeriod(query.data.since, query.data.until);
      const previousDateRanges = [{ startDate: previous.since, endDate: previous.until }];
      const warnings: string[] = [];

      const safeReport = async (label: string, body: Record<string, unknown>) => {
        try {
          return await runReport(token, connection.propertyId!, body);
        } catch (error: any) {
          warnings.push(`${label}: ${googleErrorMessage(error)}`);
          return null;
        }
      };

      const [
        summaryReport,
        previousSummaryReport,
        extendedSummaryReport,
        dailyReport,
        channelsReport,
        sourcesReport,
        landingPagesReport,
        pagesReport,
        devicesReport,
        countriesReport,
        citiesReport,
        eventsReport,
        campaignsReport,
      ] = await Promise.all([
        runReport(token, connection.propertyId, {
          dateRanges,
          metrics: ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'engagementRate', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
        }),
        safeReport('Comparativo do período anterior indisponível', {
          dateRanges: previousDateRanges,
          metrics: ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'engagementRate', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
        }),
        safeReport('Métricas avançadas indisponíveis', {
          dateRanges,
          metrics: ['bounceRate', 'averageSessionDuration', 'screenPageViews', 'screenPageViewsPerSession', 'eventCount'].map((name) => ({ name })),
        }),
        safeReport('Série diária indisponível', {
          dateRanges,
          dimensions: [{ name: 'date' }],
          metrics: ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ dimension: { dimensionName: 'date' } }],
          limit: '400',
        }),
        safeReport('Canais de aquisição indisponíveis', {
          dateRanges,
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'engagementRate', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '100',
        }),
        safeReport('Origem e mídia indisponíveis', {
          dateRanges,
          dimensions: [{ name: 'sessionSourceMedium' }],
          metrics: ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'engagementRate', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '100',
        }),
        safeReport('Landing pages indisponíveis', {
          dateRanges,
          dimensions: [{ name: 'landingPagePlusQueryString' }],
          metrics: ['sessions', 'totalUsers', 'newUsers', 'engagementRate', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '100',
        }),
        safeReport('Páginas mais acessadas indisponíveis', {
          dateRanges,
          dimensions: [{ name: 'pagePathPlusQueryString' }],
          metrics: ['screenPageViews', 'totalUsers', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: '100',
        }),
        safeReport('Dispositivos indisponíveis', {
          dateRanges,
          dimensions: [{ name: 'deviceCategory' }],
          metrics: ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '20',
        }),
        safeReport('Países indisponíveis', {
          dateRanges,
          dimensions: [{ name: 'country' }],
          metrics: ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '50',
        }),
        safeReport('Cidades indisponíveis', {
          dateRanges,
          dimensions: [{ name: 'city' }],
          metrics: ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '50',
        }),
        safeReport('Eventos indisponíveis', {
          dateRanges,
          dimensions: [{ name: 'eventName' }],
          metrics: ['eventCount', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
          limit: '100',
        }),
        safeReport('Campanhas de aquisição indisponíveis', {
          dateRanges,
          dimensions: [{ name: 'sessionCampaignName' }, { name: 'sessionSourceMedium' }],
          metrics: ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '100',
        }),
      ]);

      let realtime = { available: false, activeUsers: 0, warning: null as string | null };
      try {
        const realtimeReport = await runRealtimeReport(token, connection.propertyId, {
          metrics: [{ name: 'activeUsers' }],
        });
        realtime = {
          available: true,
          activeUsers: metricNumber(realtimeReport?.rows?.[0] || {}, realtimeReport?.metricHeaders || [], 'activeUsers'),
          warning: null,
        };
      } catch (error: any) {
        realtime = {
          available: false,
          activeUsers: 0,
          warning: 'O indicador em tempo real não está disponível para esta propriedade no momento.',
        };
        warnings.push(`Tempo real indisponível: ${googleErrorMessage(error)}`);
      }

      let googleAds: any = { available: true, warning: null, totals: {}, campaigns: [] };
      try {
        const adsReport = await runReport(token, connection.propertyId, {
          dateRanges,
          dimensions: [{ name: 'sessionGoogleAdsCampaignName' }, { name: 'sessionGoogleAdsCustomerId' }],
          metrics: ['sessions', 'keyEvents', 'totalRevenue', 'advertiserAdCost', 'advertiserAdClicks', 'advertiserAdImpressions'].map((name) => ({ name })),
          orderBys: [{ metric: { metricName: 'advertiserAdCost' }, desc: true }],
          limit: '500',
        });

        const campaigns = (adsReport?.rows || []).map((row: any) => {
          const d = adsReport.dimensionHeaders || [];
          const m = adsReport.metricHeaders || [];
          const name = dimensionValue(row, d, 'sessionGoogleAdsCampaignName');
          const cost = metricNumber(row, m, 'advertiserAdCost');
          const clicks = metricNumber(row, m, 'advertiserAdClicks');
          const impressions = metricNumber(row, m, 'advertiserAdImpressions');
          const keyEvents = metricNumber(row, m, 'keyEvents');
          const revenue = metricNumber(row, m, 'totalRevenue');
          const sessions = metricNumber(row, m, 'sessions');

          return {
            name,
            customerId: dimensionValue(row, d, 'sessionGoogleAdsCustomerId'),
            sessions,
            cost,
            clicks,
            impressions,
            keyEvents,
            revenue,
            ctr: impressions ? clicks / impressions : 0,
            cpc: clicks ? cost / clicks : 0,
            cpm: impressions ? (cost / impressions) * 1000 : 0,
            costPerKeyEvent: keyEvents ? cost / keyEvents : 0,
            keyEventRate: sessions ? keyEvents / sessions : 0,
            roas: cost ? revenue / cost : 0,
          };
        }).filter((item: any) => item.name && item.name !== '(not set)');

        const totals = campaigns.reduce((acc: any, row: any) => {
          acc.sessions += row.sessions;
          acc.cost += row.cost;
          acc.clicks += row.clicks;
          acc.impressions += row.impressions;
          acc.keyEvents += row.keyEvents;
          acc.revenue += row.revenue;
          return acc;
        }, { sessions: 0, cost: 0, clicks: 0, impressions: 0, keyEvents: 0, revenue: 0 });

        googleAds = {
          available: true,
          warning: null,
          totals: {
            ...totals,
            ctr: totals.impressions ? totals.clicks / totals.impressions : 0,
            cpc: totals.clicks ? totals.cost / totals.clicks : 0,
            cpm: totals.impressions ? (totals.cost / totals.impressions) * 1000 : 0,
            costPerKeyEvent: totals.keyEvents ? totals.cost / totals.keyEvents : 0,
            keyEventRate: totals.sessions ? totals.keyEvents / totals.sessions : 0,
            roas: totals.cost ? totals.revenue / totals.cost : 0,
          },
          campaigns,
        };
      } catch (error: any) {
        googleAds = {
          available: false,
          warning: 'Os dados do Google Ads não estão disponíveis nesta propriedade GA4. Confirme se a conta Google Ads está vinculada ao Analytics e se há dados de custo no período.',
          detail: process.env.NODE_ENV === 'production' ? undefined : googleErrorMessage(error),
          totals: {},
          campaigns: [],
        };
      }

      const baseSummary = parseSummary(summaryReport);
      const extendedSummary = extendedSummaryReport ? parseExtendedSummary(extendedSummaryReport) : {
        bounceRate: 0,
        averageSessionDuration: 0,
        screenPageViews: 0,
        screenPageViewsPerSession: 0,
        eventCount: 0,
      };
      const summary = {
        ...baseSummary,
        ...extendedSummary,
        keyEventRate: baseSummary.sessions ? baseSummary.keyEvents / baseSummary.sessions : 0,
        newUserRate: baseSummary.totalUsers ? baseSummary.newUsers / baseSummary.totalUsers : 0,
        revenuePerSession: baseSummary.sessions ? baseSummary.totalRevenue / baseSummary.sessions : 0,
      };

      const previousSummary = previousSummaryReport ? parseSummary(previousSummaryReport) : null;

      await prisma.googleAnalyticsConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date(), lastError: null },
      });

      return ok({
        client: { id: client.id, name: client.name },
        property: { id: connection.propertyId, name: connection.propertyName },
        period: { since: query.data.since, until: query.data.until },
        previousPeriod: previous,
        summary,
        previousSummary,
        realtime,
        daily: dailyReport ? parseDimensionRows(dailyReport, ['date'], ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue']) : [],
        channels: channelsReport ? parseDimensionRows(channelsReport, ['sessionDefaultChannelGroup'], ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'engagementRate', 'keyEvents', 'totalRevenue']) : [],
        sources: sourcesReport ? parseDimensionRows(sourcesReport, ['sessionSourceMedium'], ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'engagementRate', 'keyEvents', 'totalRevenue']) : [],
        landingPages: landingPagesReport ? parseDimensionRows(landingPagesReport, ['landingPagePlusQueryString'], ['sessions', 'totalUsers', 'newUsers', 'engagementRate', 'keyEvents', 'totalRevenue']) : [],
        pages: pagesReport ? parseDimensionRows(pagesReport, ['pagePathPlusQueryString'], ['screenPageViews', 'totalUsers', 'keyEvents', 'totalRevenue']) : [],
        devices: devicesReport ? parseDimensionRows(devicesReport, ['deviceCategory'], ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue']) : [],
        countries: countriesReport ? parseDimensionRows(countriesReport, ['country'], ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue']) : [],
        cities: citiesReport ? parseDimensionRows(citiesReport, ['city'], ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue']) : [],
        events: eventsReport ? parseDimensionRows(eventsReport, ['eventName'], ['eventCount', 'keyEvents', 'totalRevenue']) : [],
        campaigns: campaignsReport ? parseDimensionRows(campaignsReport, ['sessionCampaignName', 'sessionSourceMedium'], ['sessions', 'totalUsers', 'keyEvents', 'totalRevenue']) : [],
        googleAds,
        warnings: process.env.NODE_ENV === 'production' ? [] : warnings,
        source: 'Google Analytics Data API (GA4)',
        updatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      const message = googleErrorMessage(error);
      await prisma.googleAnalyticsConnection.update({
        where: { id: connection.id },
        data: { lastError: message },
      });
      return reply.code(502).send(fail(
        'GOOGLE_ANALYTICS_DECISION_REPORT_ERROR',
        'Não foi possível consultar o dashboard completo desta propriedade GA4.',
        { detail: process.env.NODE_ENV === 'production' ? undefined : message },
      ));
    }
  });
}
