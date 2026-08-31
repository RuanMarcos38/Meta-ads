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
import { registerMetaDisconnectRoutes } from './metaDisconnectRoutes.js';
import { registerTenantRoutes } from './tenantRoutes.js';
import { registerBmAccessRoutes } from './bmAccessRoutes.js';
import { registerMetaBusinessRoutes } from './metaBusinessRoutes.js';
import { registerMetaAccountAssignmentRoutes } from './metaAccountAssignmentRoutes.js';
import { registerPerformanceRoutes } from './performanceRoutes.js';
import { registerSupportRoutes } from './supportRoutes.js';
import { registerWorkspaceRoutes } from './workspaceRoutes.js';
import { registerBreakdownRoutes } from './breakdownRoutes.js';
import { registerTenantIsolation } from './tenantIsolation.js';
import { registerDestructiveAdminRoutes } from './destructiveAdminRoutes.js';

export async function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: 14 * 1024 * 1024,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });
  await app.register(jwt, { secret: env.jwtSecret });
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
  await registerTenantIsolation(app);

  await registerDatabaseDiagnostics(app);
  await registerRoutes(app);
  await registerOperationalRoutes(app);
  await registerMetaDiagnostics(app);
  await registerMetaDisconnectRoutes(app);
  await registerTenantRoutes(app);
  await registerBmAccessRoutes(app);
  await registerMetaBusinessRoutes(app);
  await registerMetaAccountAssignmentRoutes(app);
  await registerPerformanceRoutes(app);
  await registerBreakdownRoutes(app);
  await registerSupportRoutes(app);
  await registerWorkspaceRoutes(app);
  await registerDestructiveAdminRoutes(app);
  return app;
}
