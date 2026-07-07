'use strict';

const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const SERVICE_NAME = 'gestao-ads-api';
const WEB_ORIGIN = process.env.WEB_ORIGIN || '*';
const primaryPort = Number(process.env.PORT || process.env.API_PORT || 3333);
const ports = Array.from(new Set([primaryPort, 3333, 3000].filter(Boolean)));

const demoUser = {
  id: 'usr_admin_demo',
  name: 'Administrador',
  email: 'admin@r2rmarketingdigital.com.br',
  role: 'ADMIN',
  tenantId: 'tenant_r2r',
  clientId: null
};

const clients = [
  { id: 'client_r2r', name: 'R2R Marketing Digital', status: 'ACTIVE' },
  { id: 'client_ecojoi', name: 'Ecojoi Copos Personalizados', status: 'ACTIVE' },
  { id: 'client_demo', name: 'Cliente Demonstração', status: 'ACTIVE' }
];

const campaigns = [
  { id: 'cmp_001', clientId: 'client_r2r', platform: 'META', name: 'Landing Page Profissional', objective: 'Conversas', status: 'ACTIVE', spend: 4250.90, impressions: 186430, reach: 84320, clicks: 6480, results: 392, ctr: 3.48, cpc: 0.66, cpm: 22.80, costPerResult: 10.84 },
  { id: 'cmp_002', clientId: 'client_r2r', platform: 'GOOGLE', name: 'CRM com IA para Empresas', objective: 'Leads', status: 'ACTIVE', spend: 3980.00, impressions: 122880, reach: 70200, clicks: 4810, results: 266, ctr: 3.91, cpc: 0.83, cpm: 32.39, costPerResult: 14.96 },
  { id: 'cmp_003', clientId: 'client_r2r', platform: 'META', name: 'Remarketing WhatsApp', objective: 'Conversas', status: 'ACTIVE', spend: 2742.30, impressions: 164450, reach: 62870, clicks: 5034, results: 598, ctr: 3.06, cpc: 0.54, cpm: 16.68, costPerResult: 4.59 },
  { id: 'cmp_004', clientId: 'client_r2r', platform: 'GOOGLE', name: 'Pesquisa Google - Gestão Ads', objective: 'Leads', status: 'PAUSED', spend: 1629.90, impressions: 139000, reach: 52100, clicks: 2102, results: 254, ctr: 1.51, cpc: 0.78, cpm: 11.73, costPerResult: 6.42 }
];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': WEB_ORIGIN === '*' ? '*' : WEB_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders()
  });
  res.end(JSON.stringify(payload, null, 2));
}

function html(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders()
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function tokenFor(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    clientId: user.clientId,
    iat: Math.floor(Date.now() / 1000)
  })).toString('base64url');
  const signature = crypto.createHash('sha256').update(payload + (process.env.JWT_SECRET || 'demo-secret')).digest('base64url');
  return `demo.${payload}.${signature}`;
}

function summary() {
  const totalSpend = campaigns.reduce((sum, item) => sum + item.spend, 0);
  const totalImpressions = campaigns.reduce((sum, item) => sum + item.impressions, 0);
  const totalReach = campaigns.reduce((sum, item) => sum + item.reach, 0);
  const totalClicks = campaigns.reduce((sum, item) => sum + item.clicks, 0);
  const totalResults = campaigns.reduce((sum, item) => sum + item.results, 0);
  const ctr = totalImpressions ? (totalClicks / totalImpressions) * 100 : 0;
  const cpc = totalClicks ? totalSpend / totalClicks : 0;
  const cpm = totalImpressions ? (totalSpend / totalImpressions) * 1000 : 0;
  const costPerResult = totalResults ? totalSpend / totalResults : 0;

  return {
    period: 'Últimos 30 dias',
    statusApi: 'Demo online',
    updatedAt: new Date().toISOString(),
    totals: {
      spend: Number(totalSpend.toFixed(2)),
      impressions: totalImpressions,
      reach: totalReach,
      clicks: totalClicks,
      results: totalResults,
      ctr: Number(ctr.toFixed(2)),
      cpc: Number(cpc.toFixed(2)),
      cpm: Number(cpm.toFixed(2)),
      costPerResult: Number(costPerResult.toFixed(2))
    },
    campaigns,
    distribution: [
      { platform: 'Meta Ads', spend: Number(campaigns.filter(c => c.platform === 'META').reduce((sum, c) => sum + c.spend, 0).toFixed(2)) },
      { platform: 'Google Ads', spend: Number(campaigns.filter(c => c.platform === 'GOOGLE').reduce((sum, c) => sum + c.spend, 0).toFixed(2)) }
    ]
  };
}

async function handler(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname.replace(/\/$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'GET' && (pathname === '/' || pathname === '/health' || pathname === '/api/health')) {
    json(res, 200, {
      ok: true,
      service: SERVICE_NAME,
      status: 'healthy',
      port: primaryPort,
      time: new Date().toISOString()
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/integrations/meta/callback') {
    const code = requestUrl.searchParams.get('code');
    const error = requestUrl.searchParams.get('error');
    const state = requestUrl.searchParams.get('state');
    html(res, 200, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Meta Ads conectado</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial,sans-serif;background:#0f172a;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:560px;background:#111c35;border:1px solid #263554;border-radius:18px;padding:28px}h1{font-size:24px;margin:0 0 10px}.ok{color:#22c55e}.err{color:#ef4444}p{color:#cbd5e1;line-height:1.5}</style></head><body><main class="card"><h1 class="${error ? 'err' : 'ok'}">Callback Meta Ads ativo</h1><p>A URL de redirecionamento da Gestão Ads está online e pronta para validação.</p><p><strong>Status:</strong> ${error ? 'Erro retornado pela Meta' : 'Disponível'}</p><p><strong>Code recebido:</strong> ${code ? 'Sim' : 'Não'}</p><p><strong>State:</strong> ${state || 'não informado'}</p></main></body></html>`);
    return;
  }

  if (req.method === 'GET' && pathname === '/integrations/google/callback') {
    html(res, 200, '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Google Ads callback</title></head><body><h1>Callback Google Ads ativo</h1><p>A URL está online.</p></body></html>');
    return;
  }

  if (req.method === 'POST' && (pathname === '/auth/login' || pathname === '/api/auth/login')) {
    const body = await readBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    if (email === 'admin@r2rmarketingdigital.com.br' && password === '123456') {
      json(res, 200, { token: tokenFor(demoUser), user: demoUser });
      return;
    }
    json(res, 401, { ok: false, message: 'E-mail ou senha inválidos.' });
    return;
  }

  if (req.method === 'GET' && (pathname === '/clients' || pathname === '/api/clients')) {
    json(res, 200, { clients });
    return;
  }

  if (req.method === 'GET' && (pathname === '/dashboard/summary' || pathname === '/api/dashboard/summary' || pathname === '/campaigns' || pathname === '/api/campaigns')) {
    json(res, 200, summary());
    return;
  }

  if (req.method === 'POST' && (pathname === '/sync' || pathname === '/api/sync')) {
    json(res, 200, { ok: true, message: 'Sincronização demo executada.', updatedAt: new Date().toISOString(), summary: summary().totals });
    return;
  }

  json(res, 404, {
    ok: false,
    message: 'Rota não encontrada.',
    path: pathname,
    availableRoutes: ['GET /', 'GET /health', 'GET /integrations/meta/callback', 'POST /auth/login', 'GET /dashboard/summary']
  });
}

function startServer(port) {
  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      console.error('Erro inesperado:', error);
      json(res, 500, { ok: false, message: 'Erro interno da API.' });
    });
  });

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.warn(`[${SERVICE_NAME}] porta ${port} já está em uso, ignorando fallback.`);
      return;
    }
    console.error(`[${SERVICE_NAME}] erro ao iniciar na porta ${port}:`, error);
    process.exitCode = 1;
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[${SERVICE_NAME}] online em 0.0.0.0:${port}`);
  });
}

ports.forEach(startServer);

process.on('SIGTERM', () => {
  console.log(`[${SERVICE_NAME}] encerrando por SIGTERM`);
  process.exit(0);
});
