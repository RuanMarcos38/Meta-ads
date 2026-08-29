import axios from 'axios';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { prisma } from './shared/prisma.js';
import { requireAuth, type AuthUser } from './shared/auth.js';
import { ok } from './shared/response.js';

const REQUIRED_SCOPES = ['ads_read', 'ads_management', 'business_management'] as const;
const RECOMMENDED_API_VERSION = 'v25.0';
const EXPECTED_REDIRECT_URI = 'https://api-gestao.r2rmarketingdigital.com.br/meta/oauth/callback';
const EXPECTED_APP_DOMAINS = [
  'gestao.r2rmarketingdigital.com.br',
  'api-gestao.r2rmarketingdigital.com.br',
];

function configurationReady() {
  return Boolean(env.meta.appId && env.meta.appSecret && env.meta.redirectUri);
}

export async function registerMetaDiagnostics(app: FastifyInstance) {
  app.get('/meta/diagnostics', {
    preHandler: requireAuth(['SUPER_ADMIN', 'AGENCY_ADMIN']),
  }, async (req) => {
    const user = req.user as AuthUser;
    const configured = configurationReady();

    const [activeConnections, activeAccounts, lastSync] = await Promise.all([
      prisma.metaConnection.count({
        where: { organizationId: user.organizationId!, status: 'active' },
      }),
      prisma.metaAdAccount.count({
        where: { organizationId: user.organizationId!, isActive: true },
      }),
      prisma.syncJob.findFirst({
        where: { organizationId: user.organizationId! },
        orderBy: { startedAt: 'desc' },
        select: {
          type: true,
          status: true,
          startedAt: true,
          finishedAt: true,
          recordsProcessed: true,
          errorMessage: true,
        },
      }),
    ]);

    let graphReachable = false;
    let appCredentialsValid = false;
    let graphErrorCode: string | number | null = null;

    if (configured) {
      try {
        const response = await axios.get(`https://graph.facebook.com/${env.meta.apiVersion}/oauth/access_token`, {
          timeout: 8_000,
          params: {
            client_id: env.meta.appId,
            client_secret: env.meta.appSecret,
            grant_type: 'client_credentials',
          },
        });
        graphReachable = true;
        appCredentialsValid = Boolean(response.data?.access_token);
      } catch (error: any) {
        graphReachable = Boolean(error?.response);
        graphErrorCode = error?.response?.data?.error?.code
          ?? error?.response?.status
          ?? error?.code
          ?? 'META_REQUEST_FAILED';
      }
    }

    return ok({
      configured,
      graphReachable,
      appCredentialsValid,
      graphErrorCode,
      apiVersion: env.meta.apiVersion,
      recommendedApiVersion: RECOMMENDED_API_VERSION,
      apiVersionCurrent: env.meta.apiVersion === RECOMMENDED_API_VERSION,
      redirectUri: env.meta.redirectUri || EXPECTED_REDIRECT_URI,
      redirectUriMatchesProduction: env.meta.redirectUri === EXPECTED_REDIRECT_URI,
      expectedRedirectUri: EXPECTED_REDIRECT_URI,
      expectedAppDomains: EXPECTED_APP_DOMAINS,
      requiredScopes: REQUIRED_SCOPES,
      activeConnections,
      activeAccounts,
      lastSync,
    });
  });
}
