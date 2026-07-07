import { spawnSync } from 'node:child_process';

const aliases = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'POSTGRES_CONNECTION_STRING',
  'DATABASE_PRIVATE_URL',
  'DATABASE_PUBLIC_URL',
  'POSTGRES_PRISMA_URL',
  'PG_DATABASE_URL'
];

function resolveDatabaseUrl() {
  for (const key of aliases) {
    const value = process.env[key];
    if (value && String(value).trim()) return { key, value: String(value).trim() };
  }
  return null;
}

function run(label, args) {
  console.log(`[startup] ${label}`);
  const result = spawnSync('npx', args, { stdio: 'inherit', env: process.env });
  return result.status ?? 1;
}

const database = resolveDatabaseUrl();
if (!database) {
  console.error('[startup] Banco PostgreSQL nao configurado. Configure DATABASE_URL no EasyPanel.');
  console.error(`[startup] Aliases aceitos: ${aliases.join(', ')}`);
  process.exit(1);
}

process.env.DATABASE_URL = database.value;

if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL)) {
  console.error(`[startup] ${database.key} nao e uma URL PostgreSQL valida.`);
  process.exit(1);
}

console.log(`[startup] Banco detectado via ${database.key}.`);

const validateStatus = run('Validando Prisma schema', ['prisma', 'validate']);
if (validateStatus !== 0) process.exit(validateStatus);

const migrateStatus = run('Aplicando migrations', ['prisma', 'migrate', 'deploy']);
if (migrateStatus === 0) process.exit(0);

if (String(process.env.PRISMA_DB_PUSH_FALLBACK || 'true').toLowerCase() === 'false') process.exit(migrateStatus);

console.warn('[startup] migrate deploy falhou. Tentando db push para primeiro deploy.');
const pushStatus = run('Sincronizando schema', ['prisma', 'db', 'push', '--skip-generate']);
process.exit(pushStatus);
