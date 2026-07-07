import Fastify from 'fastify';
import cors from '@fastify/cors';
import cron from 'node-cron';
import { env } from './env.js';
import { prisma } from './db.js';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/clients.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { integrationRoutes } from './routes/integrations.js';
import { syncClientMetrics } from './services/metrics.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: env.WEB_ORIGIN,
  credentials: true
});

app.get('/health', async () => ({ ok: true, service: 'ads-dashboard-api', time: new Date().toISOString() }));

await app.register(authRoutes);
await app.register(clientRoutes);
await app.register(dashboardRoutes);
await app.register(integrationRoutes);

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error.name === 'ZodError') return reply.code(400).send({ message: 'Dados inválidos.', details: error });
  return reply.code(500).send({ message: error.message || 'Erro interno.' });
});

cron.schedule(env.SYNC_CRON, async () => {
  const clients = await prisma.client.findMany({ select: { id: true } });
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 7);
  const from = fromDate.toISOString().slice(0, 10);
  for (const client of clients) {
    try { await syncClientMetrics({ clientId: client.id, from, to }); }
    catch (error) { app.log.error({ error, clientId: client.id }, 'sync failed'); }
  }
});

app.listen({ port: env.API_PORT, host: '0.0.0.0' }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
