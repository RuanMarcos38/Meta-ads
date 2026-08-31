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

const DEFAULT_SUPABASE_PROJECT_REF = 'iqrnytsgwaiegddfxfjs';
const DEFAULT_SUPABASE_SESSION_POOLER_HOST = 'aws-0-us-west-2.pooler.supabase.com';
const DIAGNOSTIC_JWT_SECRET = 'diagnostic-only-jwt-secret-change-this-in-production-2026';
const DIAGNOSTIC_REFRESH_SECRET = 'diagnostic-only-refresh-secret-change-this-in-production-2026';
const MIN_META_API_MAJOR = 25;
const DEFAULT_META_API_VERSION = 'v25.0';
const PRODUCTION_META_REDIRECT_URI = 'https://api-gestao.r2rmarketingdigital.com.br/meta/oauth/callback';

function firstConfigured(keys: readonly string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePostgresUrl(value: string): string {
  const trimmed = value.trim();
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) return trimmed;

  const match = trimmed.match(
    /^(postgres(?:ql)?:\/\/)([^:/?#]+):(.+)@([^/?#:]+)(:\d+)?(\/[^?]*)?(\?.*)?$/i,
  );
  if (!match) return trimmed;

  const [, protocol, rawUsername, rawPassword, hostname, port = '', pathname = '/postgres', query = ''] = match;
  const username = encodeURIComponent(decodeSafely(rawUsername));
  const password = encodeURIComponent(decodeSafely(rawPassword));
  return `${protocol}${username}:${password}@${hostname}${port}${pathname || '/postgres'}${query}`;
}

function preferSupabaseSessionPooler(value: string, expectedRef: string): string {
  if (!value || !/^postgres(ql)?:\/\//i.test(value)) return value;

  try {
    const parsed = new URL(normalizePostgresUrl(value));
    const directHost = `db.${expectedRef}.supabase.co`;
    if (parsed.hostname !== directHost) return value;

    const decodedUsername = decodeSafely(parsed.username || 'postgres');
    const poolerUsername = decodedUsername.endsWith(`.${expectedRef}`)
      ? decodedUsername
      : `${decodedUsername}.${expectedRef}`;

    parsed.hostname = DEFAULT_SUPABASE_SESSION_POOLER_HOST;
    parsed.port = '5432';
    parsed.username = poolerUsername;
    parsed.searchParams.set('sslmode', 'require');
    return parsed.toString();
  } catch {
    return value;
  }
}

function databaseUrlWithSchema(
  value: string,
  schema: string,
  configurationErrors: string[],
  variableName: string,
): string {
  if (!value) return '';
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    configurationErrors.push(`${variableName} não é uma URL PostgreSQL válida.`);
    return '';
  }

  try {
    const parsed = new URL(normalizePostgresUrl(value));
    parsed.searchParams.set('schema', schema);
    return parsed.toString();
  } catch {
    configurationErrors.push(`${variableName} está malformada. Confira a senha e a URL do Supabase.`);
    return '';
  }
}

function isLocalDatabaseHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', 'gestao-ads-db'].includes(hostname);
}

function validateExpectedSupabaseProject(
  value: string,
  expectedRef: string,
  configurationErrors: string[],
  variableName: string,
): void {
  if (!value) return;

  try {
    const parsed = new URL(value);
    if (isLocalDatabaseHost(parsed.hostname)) return;

    const username = decodeURIComponent(parsed.username || '');
    const isDirectHost = parsed.hostname === `db.${expectedRef}.supabase.co`;
    const isPoolerHost = parsed.hostname.endsWith('.pooler.supabase.com')
      && username.endsWith(`.${expectedRef}`);

    if (!isDirectHost && !isPoolerHost) {
      configurationErrors.push(
        `${variableName} deve apontar para o projeto Supabase CRM R2 MARKETING DIGITAL (${expectedRef}).`,
      );
    }
  } catch {
    configurationErrors.push(`${variableName} não pôde ser validada.`);
  }
}

function normalizeMetaApiVersion(value?: string): string {
  const configured = value?.trim() || DEFAULT_META_API_VERSION;
  const match = configured.match(/^v?(\d+)(?:\.\d+)?$/i);
  if (!match) return DEFAULT_META_API_VERSION;

  const major = Number(match[1]);
  if (!Number.isFinite(major) || major < MIN_META_API_MAJOR) return DEFAULT_META_API_VERSION;
  return `v${major}.0`;
}

const configurationErrors: string[] = [];
const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
const configuredSchema = process.env.DATABASE_SCHEMA?.trim() || 'gestao_ads';
const databaseSchema = configuredSchema === 'gestao_ads' ? configuredSchema : 'gestao_ads';
const supabaseProjectRef = process.env.SUPABASE_PROJECT_REF?.trim() || DEFAULT_SUPABASE_PROJECT_REF;

if (configuredSchema !== 'gestao_ads') {
  configurationErrors.push('DATABASE_SCHEMA deve permanecer como gestao_ads.');
}

const rawDatabaseUrl = firstConfigured(DATABASE_ALIASES);
const rawDirectUrl = process.env.DIRECT_URL?.trim() || rawDatabaseUrl;
const preferredDatabaseUrl = preferSupabaseSessionPooler(rawDatabaseUrl, supabaseProjectRef);
const preferredDirectUrl = preferSupabaseSessionPooler(rawDirectUrl, supabaseProjectRef);
const databaseUrl = databaseUrlWithSchema(preferredDatabaseUrl, databaseSchema, configurationErrors, 'DATABASE_URL');
const directUrl = databaseUrlWithSchema(preferredDirectUrl, databaseSchema, configurationErrors, 'DIRECT_URL');

if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
if (directUrl) process.env.DIRECT_URL = directUrl;

// Compatibilidade: algumas instalações já usam GOOGLE_OAUTH_* no EasyPanel.
// Preserve os nomes atuais e exponha aliases para o módulo Google Analytics.
const googleOAuthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || '';
const googleOAuthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || '';
if (!process.env.GOOGLE_ANALYTICS_CLIENT_ID?.trim() && googleOAuthClientId) {
  process.env.GOOGLE_ANALYTICS_CLIENT_ID = googleOAuthClientId;
}
if (!process.env.GOOGLE_ANALYTICS_CLIENT_SECRET?.trim() && googleOAuthClientSecret) {
  process.env.GOOGLE_ANALYTICS_CLIENT_SECRET = googleOAuthClientSecret;
}

const configuredJwtSecret = process.env.JWT_SECRET?.trim() || '';
const configuredJwtRefreshSecret = process.env.JWT_REFRESH_SECRET?.trim() || '';
const encryptionKey = process.env.ENCRYPTION_KEY?.trim() || '';
const isProduction = nodeEnv === 'production';
const metaRedirectUri = isProduction
  ? PRODUCTION_META_REDIRECT_URI
  : process.env.META_REDIRECT_URI?.trim() || PRODUCTION_META_REDIRECT_URI;

if (isProduction) {
  if (!databaseUrl) configurationErrors.push('DATABASE_URL não foi configurada corretamente no EasyPanel.');
  validateExpectedSupabaseProject(databaseUrl, supabaseProjectRef, configurationErrors, 'DATABASE_URL');
  validateExpectedSupabaseProject(directUrl, supabaseProjectRef, configurationErrors, 'DIRECT_URL');

  if (configuredJwtSecret.length < 32) {
    configurationErrors.push('JWT_SECRET precisa ter pelo menos 32 caracteres.');
  }
  if (configuredJwtRefreshSecret.length < 32) {
    configurationErrors.push('JWT_REFRESH_SECRET precisa ter pelo menos 32 caracteres.');
  }
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey) || /^0+$/.test(encryptionKey)) {
    configurationErrors.push('ENCRYPTION_KEY precisa conter 64 caracteres hexadecimais seguros.');
  }
}

export const env = {
  nodeEnv,
  isProduction,
  port: Number(process.env.PORT ?? 3333),
  databaseSchema,
  supabaseProjectRef,
  databaseUrl,
  directUrl,
  jwtSecret: configuredJwtSecret.length >= 32 ? configuredJwtSecret : DIAGNOSTIC_JWT_SECRET,
  jwtRefreshSecret: configuredJwtRefreshSecret.length >= 32
    ? configuredJwtRefreshSecret
    : DIAGNOSTIC_REFRESH_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN?.trim() || '7d',
  encryptionKey: /^[a-f0-9]{64}$/i.test(encryptionKey) ? encryptionKey : '0'.repeat(64),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  demoMode: (process.env.DEMO_MODE ?? (isProduction ? 'false' : 'true')) === 'true',
  configurationErrors: Array.from(new Set(configurationErrors)),
  meta: {
    appId: process.env.META_APP_ID?.trim() || '',
    appSecret: process.env.META_APP_SECRET?.trim() || '',
    redirectUri: metaRedirectUri,
    apiVersion: normalizeMetaApiVersion(process.env.META_API_VERSION),
  },
};
