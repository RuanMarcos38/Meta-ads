import { spawnSync } from 'node:child_process';

const aliases = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'POSTGRES_CONNECTION_STRING',
  'DATABASE_PRIVATE_URL',
  'DATABASE_PUBLIC_URL',
  'POSTGRES_PRISMA_URL',
  'PG_DATABASE_URL',
];

const DEFAULT_SUPABASE_PROJECT_REF = 'iqrnytsgwaiegddfxfjs';

function firstConfigured(keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

function withSchema(value, schema) {
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    throw new Error('A conexão informada não é uma URL PostgreSQL válida.');
  }
  const parsed = new URL(value);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

function isLocalDatabaseHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', 'gestao-ads-db'].includes(hostname);
}

function assertExpectedSupabaseProject(value, expectedRef) {
  const parsed = new URL(value);
  if (isLocalDatabaseHost(parsed.hostname)) return;

  const username = decodeURIComponent(parsed.username || '');
  const isDirectHost = parsed.hostname === `db.${expectedRef}.supabase.co`;
  const isPoolerHost = parsed.hostname.endsWith('.pooler.supabase.com')
    && username.endsWith(`.${expectedRef}`);

  if (!isDirectHost && !isPoolerHost) {
    throw new Error(
      `A conexão deve apontar exclusivamente para o projeto Supabase CRM R2 MARKETING DIGITAL (${expectedRef}).`,
    );
  }
}

function isEnabled(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return value.trim().toLowerCase() === 'true';
}

function run(label, command, args) {
  console.log(`[startup] ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  if ((result.status ?? 1) === 0) return true;

  console.error(`[startup] Falha em: ${label}. Código: ${result.status ?? 1}.`);
  console.error('[startup] A API continuará subindo para expor /health e facilitar o diagnóstico no EasyPanel.');
  return false;
}

const schema = process.env.DATABASE_SCHEMA?.trim() || 'gestao_ads';
const expectedProjectRef = process.env.SUPABASE_PROJECT_REF?.trim() || DEFAULT_SUPABASE_PROJECT_REF;

if (schema !== 'gestao_ads') {
  console.error('[startup] DATABASE_SCHEMA deve permanecer como gestao_ads.');
  console.error('[startup] O bloqueio evita alterações acidentais no schema public do CRM.');
  process.exit(1);
}

const database = firstConfigured(aliases);
if (!database) {
  console.error('[startup] Configure DATABASE_URL no EasyPanel.');
  console.error(`[startup] Variáveis aceitas: ${aliases.join(', ')}`);
  process.exit(1);
}

try {
  process.env.DATABASE_SCHEMA = schema;
  process.env.SUPABASE_PROJECT_REF = expectedProjectRef;
  process.env.DATABASE_URL = withSchema(database.value, schema);
  process.env.DIRECT_URL = withSchema(process.env.DIRECT_URL?.trim() || database.value, schema);
  assertExpectedSupabaseProject(process.env.DATABASE_URL, expectedProjectRef);
  assertExpectedSupabaseProject(process.env.DIRECT_URL, expectedProjectRef);
} catch (error) {
  console.error(`[startup] ${error instanceof Error ? error.message : 'URL de banco inválida.'}`);
  process.exit(1);
}

const parsed = new URL(process.env.DATABASE_URL);
console.log(
  `[startup] Projeto Supabase: ${expectedProjectRef} | banco=${parsed.hostname}/${parsed.pathname.replace(/^\//, '') || 'postgres'} | schema=${schema}`,
);

let databasePrepared = true;
if (isEnabled(process.env.PRISMA_DB_PUSH, true)) {
  databasePrepared = run('Sincronizando estrutura isolada do Prisma', 'npx', [
    '--no-install',
    'prisma',
    'db',
    'push',
    '--skip-generate',
  ]);
}

const seedRequested = isEnabled(process.env.RUN_SEED_ON_START, false);
const seedPasswordConfigured = Boolean(process.env.SEED_ADMIN_PASSWORD?.trim());

if ((seedRequested || seedPasswordConfigured) && databasePrepared) {
  run('Garantindo administrador inicial', 'npm', ['run', 'seed']);
} else if (seedRequested || seedPasswordConfigured) {
  console.warn('[startup] Seed administrativo ignorado porque a conexão/preparação do banco falhou.');
} else {
  console.warn('[startup] Seed administrativo não executado.');
  console.warn('[startup] Para criar o primeiro acesso, configure SEED_ADMIN_PASSWORD com 12 ou mais caracteres.');
}
