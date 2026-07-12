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

function run(label, command, args) {
  console.log(`[startup] ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

const schema = process.env.DATABASE_SCHEMA?.trim() || 'gestao_ads';
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
  process.env.DATABASE_URL = withSchema(database.value, schema);
  process.env.DIRECT_URL = withSchema(process.env.DIRECT_URL?.trim() || database.value, schema);
} catch (error) {
  console.error(`[startup] ${error instanceof Error ? error.message : 'URL de banco inválida.'}`);
  process.exit(1);
}

const parsed = new URL(process.env.DATABASE_URL);
console.log(`[startup] Banco: ${parsed.hostname}/${parsed.pathname.replace(/^\//, '') || 'postgres'} | schema=${schema}`);

if ((process.env.PRISMA_DB_PUSH ?? 'true').toLowerCase() !== 'false') {
  run('Sincronizando estrutura isolada do Prisma', 'npx', [
    '--no-install',
    'prisma',
    'db',
    'push',
    '--skip-generate',
  ]);
}

if ((process.env.RUN_SEED_ON_START ?? 'false').toLowerCase() === 'true') {
  run('Executando seed administrativo', 'npm', ['run', 'seed']);
}
