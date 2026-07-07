import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import cron from 'node-cron';
import { ZodError } from 'zod';
import { env } from './env.js';
import { prisma } from './db.js';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/clients.js';
import { userRoutes } from './routes/users.js';
import { adAccountRoutes } from './routes/adAccounts.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { featureFlagRoutes } from './routes/featureFlags.js';
import { integrationRoutes } from './routes/integrations.js';
import { reportRoutes } from './routes/reports.js';
import { syncRoutes } from './routes/sync.js';
import { syncClientMetrics } from './services/sync.js';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', '*.accessToken', '*.refreshToken', '*.access_token', '*.refresh_token']
  }
});

const allowedOrigins = new Set([
  ...env.CORS_ORIGINS,
  env.APP_URL,
  env.WEB_ORIGIN,
  env.API_URL,
  'http://localhost:3333',
  'http://127.0.0.1:3333'
].filter(Boolean));

await app.register(cors, {
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    callback(new Error(`Origem nao permitida pelo CORS: ${origin}`), false);
  }
});

await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute'
});

function healthPayload() {
  return {
    ok: true,
    service: 'gestao-ads-api',
    version: '2026.07.07-production-fix',
    environment: env.NODE_ENV,
    port: env.API_PORT,
    appUrl: env.APP_URL,
    apiUrl: env.API_URL,
    time: new Date().toISOString()
  };
}

async function readyHandler(request: any, reply: any) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ...healthPayload(), database: 'ready' };
  } catch (error) {
    request.log.error(error);
    return reply.code(503).send({ ...healthPayload(), ok: false, database: 'unavailable' });
  }
}

app.get('/health', async () => healthPayload());
app.get('/api/health', async () => healthPayload());
app.get('/ready', readyHandler);
app.get('/api/ready', readyHandler);
app.get('/api/config', async () => ({
  ok: true,
  appName: 'Gestao Ads',
  appUrl: env.APP_URL,
  apiUrl: env.API_URL,
  demoMode: env.DEMO_MODE,
  features: ['integrations', 'reports', 'sync']
}));

await app.register(authRoutes);
await app.register(clientRoutes);
await app.register(userRoutes);
await app.register(adAccountRoutes);
await app.register(featureFlagRoutes);
await app.register(dashboardRoutes);
await app.register(integrationRoutes);
await app.register(reportRoutes);
await app.register(syncRoutes);

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error instanceof ZodError) {
    return reply.code(400).send({ message: 'Dados invalidos.', details: error.flatten() });
  }
  const typedError = error as Error & { statusCode?: number };
  const statusCode = Number(typedError.statusCode || 500);
  return reply.code(statusCode).send({ message: typedError.message || 'Erro interno.' });
});

cron.schedule(env.SYNC_CRON, async () => {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 7);
  const clients = await prisma.client.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, tenantId: true }
  });

  for (const client of clients) {
    try {
      await syncClientMetrics({
        tenantId: client.tenantId,
        clientId: client.id,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10)
      });
    } catch (error) {
      app.log.error({ error, clientId: client.id }, 'scheduled sync failed');
    }
  }
});

app.listen({ port: env.API_PORT, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
