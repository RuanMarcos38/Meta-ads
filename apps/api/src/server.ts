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

await app.register(cors, {
  credentials: true,
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Origem não permitida pelo CORS.'), false);
  }
});

await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute'
});

app.get('/health', async () => ({
  ok: true,
  service: 'gestao-ads-api',
  time: new Date().toISOString()
}));

app.get('/ready', async (request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, database: 'ready' };
  } catch (error) {
    request.log.error(error);
    return reply.code(503).send({ ok: false, database: 'unavailable' });
  }
});

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
    return reply.code(400).send({ message: 'Dados inválidos.', details: error.flatten() });
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
