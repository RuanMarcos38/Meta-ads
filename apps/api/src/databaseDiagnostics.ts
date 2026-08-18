import { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { prisma } from './shared/prisma.js';
import { ok } from './shared/response.js';

type DatabaseErrorShape = {
  code?: unknown;
  name?: unknown;
  message?: unknown;
};

function safeDatabaseTarget() {
  if (!env.databaseUrl) {
    return {
      configured: false,
      host: null,
      port: null,
      usingPooler: false,
      sslMode: null,
      schema: env.databaseSchema,
      projectRef: env.supabaseProjectRef,
    };
  }

  try {
    const parsed = new URL(env.databaseUrl);
    return {
      configured: true,
      host: parsed.hostname,
      port: parsed.port || '5432',
      usingPooler: parsed.hostname.endsWith('.pooler.supabase.com'),
      sslMode: parsed.searchParams.get('sslmode'),
      schema: parsed.searchParams.get('schema') || env.databaseSchema,
      projectRef: env.supabaseProjectRef,
    };
  } catch {
    return {
      configured: true,
      host: 'invalid-url',
      port: null,
      usingPooler: false,
      sslMode: null,
      schema: env.databaseSchema,
      projectRef: env.supabaseProjectRef,
    };
  }
}

function classifyDatabaseError(error: unknown) {
  const shape = (error && typeof error === 'object' ? error : {}) as DatabaseErrorShape;
  const code = typeof shape.code === 'string' && /^P\d{4}$/.test(shape.code) ? shape.code : undefined;
  const name = typeof shape.name === 'string' ? shape.name : undefined;
  const message = typeof shape.message === 'string' ? shape.message : '';

  let category = 'UNKNOWN_DATABASE_ERROR';
  if (code === 'P1000' || /authentication failed|password authentication failed/i.test(message)) {
    category = 'AUTHENTICATION_FAILED';
  } else if (code === 'P1001' || /can't reach database server|cannot reach database server|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i.test(message)) {
    category = 'DATABASE_UNREACHABLE';
  } else if (code === 'P1002' || /timed out/i.test(message)) {
    category = 'CONNECTION_TIMEOUT';
  } else if (code === 'P1010' || /denied access/i.test(message)) {
    category = 'ACCESS_DENIED';
  } else if (code === 'P1011' || /TLS|SSL/i.test(message)) {
    category = 'TLS_ERROR';
  }

  return {
    category,
    prismaCode: code ?? null,
    errorName: name ?? null,
  };
}

export async function registerDatabaseDiagnostics(app: FastifyInstance) {
  app.get('/diagnostics/database', async () => {
    const target = safeDatabaseTarget();

    if (env.configurationErrors.length) {
      return ok({
        connected: false,
        category: 'CONFIGURATION_ERROR',
        ...target,
        issues: env.configurationErrors,
      });
    }

    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      return ok({
        connected: true,
        category: 'CONNECTED',
        ...target,
      });
    } catch (error) {
      return ok({
        connected: false,
        ...classifyDatabaseError(error),
        ...target,
      });
    }
  });
}
