const VERSION = 'gestao-ads-pwa-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Sem cache persistente propositalmente: o app continua recebendo imediatamente
// os deploys do GitHub/Hostinger e todos os dados permanecem em tempo real.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});
