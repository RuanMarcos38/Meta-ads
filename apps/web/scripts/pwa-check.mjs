import { access, readFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const required = [
  'manifest.webmanifest',
  'sw.js',
  'app-icon-180.png',
  'app-icon-192.png',
  'app-icon-512.png',
];

for (const file of required) {
  await access(new URL(file, dist));
}

const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', dist), 'utf8'));
if (manifest.display !== 'standalone') throw new Error('PWA manifest precisa usar display=standalone.');
if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) throw new Error('PWA manifest sem ícones obrigatórios.');

const html = await readFile(new URL('index.html', dist), 'utf8');
for (const requiredText of ['manifest.webmanifest', 'viewport-fit=cover', 'apple-mobile-web-app-capable']) {
  if (!html.includes(requiredText)) throw new Error(`index.html sem configuração PWA: ${requiredText}`);
}

console.log('PWA audit passed: manifest, service worker, icons and mobile viewport are present.');
