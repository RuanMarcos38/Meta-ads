import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  datasources: env.databaseUrl
    ? { db: { url: env.databaseUrl } }
    : undefined,
  log: env.isProduction ? ['error'] : ['warn', 'error'],
});

function sanitizeAuditMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const metadata = value as Record<string, unknown>;
  if (!('password' in metadata) && !('passwordHash' in metadata)) return value;

  const { password: _password, passwordHash: _passwordHash, ...safeMetadata } = metadata;
  return {
    ...safeMetadata,
    passwordChanged: true,
  };
}

prisma.$use(async (params, next) => {
  if (params.model === 'AuditLog' && params.args?.data?.metadataJson) {
    params.args.data.metadataJson = sanitizeAuditMetadata(params.args.data.metadataJson);
  }
  return next(params);
});
