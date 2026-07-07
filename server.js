'use strict';

const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

const SERVICE = 'gestao-ads-api';
const ORIGIN = process.env.WEB_ORIGIN || '*';
const primaryPort = Number(process.env.PORT || process.env.API_PORT || 3333);
const ports = Array.from(new Set([primaryPort, 3333, 333, 3000]));

const tenant = { id: 'tenant_r2r', name: 'R2R Marketing Digital' };
const user = { id: 'usr_admin', tenantId: tenant.id, clientId: null, name: 'Administrador', email: process.env.ADMIN_EMAIL || 'admin@r2rmarketingdigital.com.br', role: 'ADMIN', status: 'ACTIVE' };
const clients = [
  { id: 'client_r2r', tenantId: tenant.id, name: 'R2R Marketing Digital', tradeName: 'R2R Marketing Digital', email: 'admin@r2rmarketingdigital.com.br', status: 'ACTIVE' }
];
const campaigns = [
  { id: 'cmp_001', clientId: 'client_r2r', clientName: 'R2R Marketing Digital', provider: 'META', platform: 'META', campaignExternalId: 'meta_001', campaignName: 'Landing Page Profissional', name: 'Landing Page Profissional', objective: 'Conversas', status: 'ACTIVE', spend: 4250.90, impressions: 189430, reach: 84320, clicks: 6210, results: 486, conversions: 486, ctr: 3.28, cpc: 0.68, cpm: 22.44, costPerResult: 8.75 },
  { id: 'cmp_002', clientId: 'client_r2r', clientName: 'R2R Marketing Digital', provider: 'META', platform: 'META', campaignExternalId: 'meta_002', campaignName: 'Automacao WhatsApp IA', name: 'Automacao WhatsApp IA', objective: 'Conversas', status: 'ACTIVE', spend: 2912.40, impressions: 157220, reach: 69210, clicks: 5320, results: 512, conversions: 512, ctr: 3.38, cpc: 0.55, cpm: 18.52, costPerResult: 5.69 },
  { id: 'cmp_003', clientId: 'client_r2r', clientName: 'R2R Marketing Digital', provider: 'GOOGLE', platform: 'GOOGLE', campaignExternalId: 'google_001', campaignName: 'CRM com IA para Empresas', name: 'CRM com IA para Empresas', objective: 'Leads', status: 'ACTIVE', spend: 3380.10, impressions: 132880, reach: 64230, clicks: 3926, results: 341, conversions: 341, ctr: 2.95, cpc: 0.86, cpm: 25.44, costPerResult: 9.91 },
  { id: 'cmp_004', clientId: 'client_r2r', clientName: 'R2R Marketing Digital', provider: 'META', platform: 'META', campaignExternalId: 'meta_003', campaignName: 'Remarketing Servicos Digitais', name: 'Remarketing Servicos Digitais', objective: 'Retorno', status: 'PAUSED', spend: 2059.80, impressions: 108230, reach: 48420, clicks: 2970, results: 171, conversions: 171, ctr: 2.74, cpc: 0.69, cpm: 19.03, costPerResult: 12.05 }
];

function headers(type = 'application/json; charset=utf-8') {
  return { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': ORIGIN === '*' ? '*' : ORIGIN, 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' };
}
function json(res, status, data) { res.writeHead(status, headers()); res.end(JSON.stringify(data, null, 2)); }
function html(res, body) { res.writeHead(200, headers('text/html; charset=utf-8')); res.end(body); }
function body(req) { return new Promise((resolve) => { let raw=''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } }); req.on('error', () => resolve({})); }); }
function token() { const p = Buffer.from(JSON.stringify({ sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId, iat: Date.now() })).toString('base64url'); const s = crypto.createHash('sha256').update(p + (process.env.JWT_SECRET || 'demo')).digest('base64url'); return `demo.${p}.${s}`; }
function clean(path) { const p = (path.replace(/\/$/, '') || '/'); return p.startsWith('/api/') ? p.slice(4) || '/' : p; }
function rows(params) { const clientId = params.get('clientId'); const platform = params.get('platform'); return campaigns.filter(c => (!clientId || c.clientId === clientId) && (!platform || c.provider === platform)); }
function summary(list) { const spend=list.reduce((s,c)=>s+c.spend,0), impressions=list.reduce((s,c)=>s+c.impressions,0), reach=list.reduce((s,c)=>s+c.reach,0), clicks=list.reduce((s,c)=>s+c.clicks,0), results=list.reduce((s,c)=>s+c.results,0); return { period:'Ultimos 30 dias', summary:'Resumo consolidado das campanhas de Meta Ads e Google Ads.', statusApi:'Online', lastSyncAt:new Date().toISOString(), totals:{ spend:+spend.toFixed(2), impressions, reach, clicks, results, conversions:results, ctr: impressions ? +((clicks/impressions)*100).toFixed(2) : 0, cpc: clicks ? +(spend/clicks).toFixed(2) : 0, cpm: impressions ? +((spend/impressions)*1000).toFixed(2) : 0, costPerResult: results ? +(spend/results).toFixed(2) : 0 }, campaigns:list, distribution:[{platform:'Meta Ads', spend:+list.filter(c=>c.provider==='META').reduce((s,c)=>s+c.spend,0).toFixed(2)}, {platform:'Google Ads', spend:+list.filter(c=>c.provider==='GOOGLE').reduce((s,c)=>s+c.spend,0).toFixed(2)}] }; }

async function handler(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const path = clean(u.pathname);
  if (req.method === 'OPTIONS') { res.writeHead(204, headers()); return res.end(); }
  if (req.method === 'GET' && ['/', '/health', '/ready'].includes(path)) return json(res, 200, { ok:true, service:SERVICE, status:'healthy', port:primaryPort, listeningPorts:ports, time:new Date().toISOString() });
  if (req.method === 'POST' && path === '/auth/login') { const b = await body(req); const email=String(b.email||'').toLowerCase().trim(); const pass=String(b.password||''); if (email === String(process.env.ADMIN_EMAIL || user.email).toLowerCase() && pass === String(process.env.ADMIN_PASSWORD || '123456')) return json(res, 200, { token: token(), user }); return json(res, 401, { message:'E-mail ou senha invalidos.' }); }
  if (req.method === 'GET' && ['/auth/me','/me'].includes(path)) return json(res, 200, { user });
  if (req.method === 'POST' && path === '/auth/bootstrap') return json(res, 200, { token: token(), user, tenant });
  if (req.method === 'GET' && path === '/clients') return json(res, 200, { clients });
  if (req.method === 'GET' && path === '/users') return json(res, 200, { users:[user] });
  if (req.method === 'GET' && path === '/ad-accounts') return json(res, 200, { adAccounts:[{id:'meta_demo',clientId:'client_r2r',provider:'META',name:'Meta Ads Demo',status:'CONNECTED'},{id:'google_demo',clientId:'client_r2r',provider:'GOOGLE',name:'Google Ads Demo',status:'CONNECTED'}] });
  if (req.method === 'GET' && path === '/dashboard/summary') return json(res, 200, summary(rows(u.searchParams)));
  if (req.method === 'GET' && path === '/dashboard/campaigns') { const list=rows(u.searchParams); return json(res, 200, { campaigns:list, total:list.length }); }
  if (req.method === 'GET' && path === '/dashboard/health') { const list=rows(u.searchParams); return json(res, 200, { score: list.length ? 92 : 0, status:list.length?'good':'empty', message:list.length?'Campanhas saudaveis e API conectada.':'Nenhuma campanha encontrada.' }); }
  if (req.method === 'GET' && path === '/dashboard/daily') return json(res, 200, { days:['Seg','Ter','Qua','Qui','Sex','Sab','Dom'].map((day,i)=>({day,spend:1500+i*80,clicks:2100+i*70,results:180+i*12})) });
  if (req.method === 'GET' && path === '/dashboard/platform-distribution') return json(res, 200, { distribution:summary(rows(u.searchParams)).distribution });
  if (req.method === 'GET' && path === '/dashboard/top-campaigns') return json(res, 200, { campaigns:rows(u.searchParams).sort((a,b)=>b.spend-a.spend).slice(0,5) });
  if (req.method === 'GET' && ['/campaigns','/metrics'].includes(path)) return json(res, 200, { campaigns:rows(u.searchParams), totals:summary(rows(u.searchParams)).totals });
  if (req.method === 'POST' && ['/sync','/dashboard/sync'].includes(path)) return json(res, 200, { ok:true, message:'Sincronizacao executada com sucesso.', updatedAt:new Date().toISOString(), summary:summary(rows(u.searchParams)).totals });
  if (req.method === 'GET' && path === '/integrations') return json(res, 200, { integrations:[{provider:'META',status:'READY',callbackUrl:process.env.META_REDIRECT_URI || 'https://api-gestao.r2rmarketingdigital.com.br/integrations/meta/callback'},{provider:'GOOGLE',status:'READY',callbackUrl:process.env.GOOGLE_ADS_REDIRECT_URI || 'https://api-gestao.r2rmarketingdigital.com.br/integrations/google/callback'}] });
  if (req.method === 'GET' && path === '/integrations/meta/connect') return json(res, 200, { provider:'META', redirectUri:process.env.META_REDIRECT_URI || 'https://api-gestao.r2rmarketingdigital.com.br/integrations/meta/callback' });
  if (req.method === 'GET' && path === '/integrations/meta/callback') return html(res, '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Meta Ads conectado</title></head><body><h1>Callback Meta Ads ativo</h1><p>URL online e pronta para validacao.</p></body></html>');
  if (req.method === 'GET' && path === '/integrations/google/callback') return html(res, '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Google Ads conectado</title></head><body><h1>Callback Google Ads ativo</h1><p>URL online.</p></body></html>');
  if (req.method === 'GET' && ['/reports/export.csv','/reports/csv'].includes(path)) { const list=rows(u.searchParams); const csv='campanha;plataforma;investimento;cliques;resultados\n'+list.map(c=>`${c.campaignName};${c.provider};${c.spend};${c.clicks};${c.results}`).join('\n'); res.writeHead(200, headers('text/csv; charset=utf-8')); return res.end(csv); }
  return json(res, 404, { ok:false, message:'Rota nao encontrada.', path });
}

function start(port) { const server=http.createServer((req,res)=>handler(req,res).catch(err=>{console.error(err);json(res,500,{message:'Erro interno da API.'});})); server.on('error',err=>{ if(err.code==='EADDRINUSE') return console.warn(`${SERVICE} porta ${port} ocupada`); console.error(err); }); server.listen(port,'0.0.0.0',()=>console.log(`${SERVICE} online em 0.0.0.0:${port}`)); }
ports.forEach(start);
process.on('SIGTERM',()=>process.exit(0));
