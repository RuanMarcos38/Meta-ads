import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { registerRoutes } from './routes.js';
import { registerOperationalRoutes } from './operationalRoutes.js';
import { registerDatabaseDiagnostics } from './databaseDiagnostics.js';
import { registerMetaDiagnostics } from './metaDiagnostics.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(helmet);
  await app.register(cors, { origin: env.corsOrigins, credentials: true });
  await app.register(jwt, { secret: env.jwtSecret });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  await registerDatabaseDiagnostics(app);
  await registerRoutes(app);
  await registerOperationalRoutes(app);
  await registerMetaDiagnostics(app);
  return app;
}
