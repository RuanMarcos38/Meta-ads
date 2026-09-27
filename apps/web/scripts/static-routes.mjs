import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const routes = [
  'login',
  'agencia',
  'empresas',
  'clientes',
  'business-managers',
  'contas-meta',
  'campanhas',
  'google-analytics',
  'relatorios',
  'alertas',
  'atendimento',
  'usuarios',
  'integracoes',
  'auditoria',
  'configuracoes',
];

const indexPath = new URL('index.html', dist);
await readFile(indexPath, 'utf8');

for (const route of routes) {
  const folder = new URL(`${route}/`, dist);
  await mkdir(folder, { recursive: true });
  await copyFile(indexPath, new URL('index.html', folder));
}

// Fallback adicional para hosts estáticos que ignoram rewrite de .htaccess.
await copyFile(indexPath, new URL('404.html', dist));

const manifest = {
  generatedAt: new Date().toISOString(),
  routes: ['/', ...routes.map((route) => `/${route}`)],
};
await writeFile(new URL('static-routes.json', dist), JSON.stringify(manifest, null, 2) + '\n');

console.log(`Static route fallbacks generated: ${manifest.routes.length}`);
