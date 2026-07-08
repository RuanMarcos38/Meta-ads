import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { registerRoutes } from './routes.js';

async function main() {
  const app = Fastify({ logger: true });

  await app.register(helmet);
  await app.register(cors, { origin: env.corsOrigins, credentials: true });
  await app.register(jwt, { secret: env.jwtSecret });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  await registerRoutes(app);

  await app.listen({ port: env.port, host: '0.0.0.0' });
  app.log.info(`API rodando na porta ${env.port} | DEMO_MODE=${env.demoMode}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
