import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  datasources: env.databaseUrl
    ? { db: { url: env.databaseUrl } }
    : undefined,
  log: env.isProduction ? ['error'] : ['warn', 'error'],
});
