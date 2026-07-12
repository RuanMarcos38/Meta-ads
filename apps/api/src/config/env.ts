import 'dotenv/config';

const DATABASE_ALIASES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'POSTGRES_CONNECTION_STRING',
  'DATABASE_PRIVATE_URL',
  'DATABASE_PUBLIC_URL',
  'POSTGRES_PRISMA_URL',
  'PG_DATABASE_URL',
] as const;

function firstConfigured(keys: readonly string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
}

function databaseUrlWithSchema(value: string, schema: string): string {
  if (!value) return '';
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    throw new Error('A conexão do banco precisa ser uma URL PostgreSQL válida.');
  }

  const parsed = new URL(value);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
const databaseSchema = process.env.DATABASE_SCHEMA?.trim() || 'gestao_ads';

// Regra de segurança: este repositório nunca deve escrever no schema public do CRM.
if (databaseSchema !== 'gestao_ads') {
  throw new Error('DATABASE_SCHEMA deve permanecer como gestao_ads para evitar conflito com outros projetos.');
}

const rawDatabaseUrl = firstConfigured(DATABASE_ALIASES);
const rawDirectUrl = process.env.DIRECT_URL?.trim() || rawDatabaseUrl;
const databaseUrl = databaseUrlWithSchema(rawDatabaseUrl, databaseSchema);
const directUrl = databaseUrlWithSchema(rawDirectUrl, databaseSchema);

if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
if (directUrl) process.env.DIRECT_URL = directUrl;

const jwtSecret = process.env.JWT_SECRET?.trim() || 'dev-secret';
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET?.trim() || 'dev-refresh';
const encryptionKey = process.env.ENCRYPTION_KEY?.trim() || '0'.repeat(64);
const isProduction = nodeEnv === 'production';

if (isProduction) {
  if (!databaseUrl) throw new Error('DATABASE_URL não foi configurada no EasyPanel.');
  if (jwtSecret.length < 32 || jwtSecret === 'dev-secret') {
    throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres em produção.');
  }
  if (jwtRefreshSecret.length < 32 || jwtRefreshSecret === 'dev-refresh') {
    throw new Error('JWT_REFRESH_SECRET precisa ter pelo menos 32 caracteres em produção.');
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey) || /^0+$/.test(encryptionKey)) {
    throw new Error('ENCRYPTION_KEY precisa conter 64 caracteres hexadecimais seguros em produção.');
  }
}

export const env = {
  nodeEnv,
  isProduction,
  port: Number(process.env.PORT ?? 3333),
  databaseSchema,
  databaseUrl,
  directUrl,
  jwtSecret,
  jwtRefreshSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN?.trim() || '7d',
  encryptionKey,
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  demoMode: (process.env.DEMO_MODE ?? (isProduction ? 'false' : 'true')) === 'true',
  meta: {
    appId: process.env.META_APP_ID?.trim() || '',
    appSecret: process.env.META_APP_SECRET?.trim() || '',
    redirectUri: process.env.META_REDIRECT_URI?.trim() || '',
    apiVersion: process.env.META_API_VERSION?.trim() || 'v21.0',
  },
};
