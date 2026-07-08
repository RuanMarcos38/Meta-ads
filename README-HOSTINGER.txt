GESTÃO ADS — PUBLICAÇÃO NA HOSTINGER

FRONTEND:
1. Entre na pasta apps/web.
2. Configure .env:
   VITE_API_BASE_URL=https://api-gestao.r2rmarketingdigital.com.br
3. Execute:
   npm install
   npm run build
4. Suba TODO o conteúdo da pasta apps/web/dist para o public_html do subdomínio:
   gestao.r2rmarketingdigital.com.br

ARQUIVOS ESPERADOS NO PUBLIC_HTML:
- index.html
- assets/
- .htaccess

BACKEND:
O backend deve rodar separado em VPS/EasyPanel, pois Hostinger comum não roda Node API em produção estável.

Configuração EasyPanel:
- Repository: RuanMarcos38/Meta-ads
- Branch: main ou feat/gestao-ads-saas-completo
- Build Path: /
- Dockerfile: Dockerfile
- Porta interna: 3333
- Healthcheck: /health
- Domínio: api-gestao.r2rmarketingdigital.com.br

VARIÁVEIS PRINCIPAIS:
NODE_ENV=production
PORT=3333
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
JWT_SECRET=gere_uma_chave_forte
JWT_REFRESH_SECRET=gere_uma_chave_forte
ENCRYPTION_KEY=gere_64_caracteres_hex
CORS_ORIGINS=https://gestao.r2rmarketingdigital.com.br
DEMO_MODE=false
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=https://api-gestao.r2rmarketingdigital.com.br/meta/oauth/callback
