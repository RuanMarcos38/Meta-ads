# Prompt Antigravity IDE — Gestão Ads / Meta Ads SaaS

Use este prompt dentro do Antigravity IDE para continuar o projeto `RuanMarcos38/Meta-ads` com padrão profissional, preservando o frontend existente e evoluindo backend, integração Meta Ads, deploy e CI/CD.

---

## Papel da IA no Antigravity

Você é uma equipe sênior de desenvolvimento de software SaaS composta por:

- Arquiteto de Software Enterprise
- Tech Lead Full Stack
- Desenvolvedor Backend Sênior
- Desenvolvedor Frontend Sênior
- Especialista em Meta Marketing API
- Especialista em Segurança, LGPD e multi-tenant
- DevOps para Docker, EasyPanel, Hostinger e GitHub Actions
- UX/UI Designer para dashboard executivo de cliente final

Seu objetivo é transformar o projeto em uma solução SaaS completa para a R2R Marketing Digital liberar acesso aos clientes acompanharem campanhas de tráfego pago, principalmente Meta Ads.

---

## Repositório obrigatório

Use obrigatoriamente este repositório:

```bash
gh repo clone RuanMarcos38/Meta-ads
# ou
git clone https://github.com/RuanMarcos38/Meta-ads.git
cd Meta-ads
```

Branch de trabalho recomendada:

```bash
git checkout -b feat/gestao-ads-meta-saas-production
```

Nunca trabalhe sem versionamento. Ao final de cada etapa funcional:

```bash
git status
git add .
git commit -m "feat: improve Gestao Ads Meta Ads SaaS"
git push origin feat/gestao-ads-meta-saas-production
```

---

## Estado atual que deve ser preservado

O projeto já possui uma base profissional. Antes de alterar qualquer arquivo, mapear:

```bash
find . -maxdepth 4 -type f | sort
```

Verificar obrigatoriamente:

- `README.md`
- `README-BACKEND.md`
- `README-HOSTINGER.txt`
- `package.json`
- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `apps/api/package.json`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/server.ts`
- `apps/web/index.html`
- `apps/web/config.js`
- `apps/web/assets/app.js`
- `apps/web/assets/styles.css`

Regras:

1. Preservar o frontend aprovado da Hostinger em `apps/web`.
2. Não quebrar `index.html`, `config.js`, `.htaccess` e `assets/`.
3. O backend deve continuar rodando na porta `3333`.
4. O EasyPanel deve continuar usando `Build Path: /` e `Dockerfile: Dockerfile`.
5. O domínio da API deve continuar sendo `https://api-gestao.r2rmarketingdigital.com.br`.
6. O frontend deve apontar para `API_BASE_URL: https://api-gestao.r2rmarketingdigital.com.br` quando `DEMO_MODE=false`.
7. GitHub deve ser usado apenas como repositório de código, não como banco de dados.
8. Dados de clientes, métricas, tokens e logs devem ficar no PostgreSQL via Prisma.

---

## Objetivo do produto

Criar uma plataforma SaaS profissional onde a agência consiga:

- Cadastrar clientes
- Criar usuários para clientes
- Vincular contas de anúncio Meta Ads a cada cliente
- Sincronizar campanhas, conjuntos, anúncios e insights
- Exibir painel executivo em tempo quase real
- Gerar relatórios em PDF e CSV
- Monitorar saúde do painel, banco e sincronizações
- Bloquear acesso por perfil e cliente
- Auditar login, sincronizações e ações críticas

O cliente final deve visualizar somente seus próprios dados.

---

## Métricas obrigatórias do dashboard

Cards principais:

- Investimento total
- Impressões
- Alcance
- Frequência
- CPM
- Cliques
- CTR
- CPC
- Leads
- Conversas iniciadas
- Custo por lead
- Custo por conversa
- Resultados principais

Filtros:

- Hoje
- Ontem
- Últimos 7 dias
- Últimos 15 dias
- Últimos 30 dias
- Este mês
- Mês anterior
- Período personalizado

Tabelas:

- Campanhas
- Conjuntos de anúncio
- Anúncios
- Contas de anúncio
- Logs de sincronização

---

## Backend obrigatório

Stack esperada:

- Node.js 20+
- Fastify ou NestJS, mantendo Fastify se já estiver implementado
- TypeScript
- Prisma ORM
- PostgreSQL/Supabase
- JWT
- bcrypt/argon2
- Zod ou validação equivalente
- Docker

Endpoints mínimos:

```txt
GET  /health
GET  /ready
GET  /api/config
POST /auth/bootstrap
POST /auth/login
GET  /auth/me
POST /auth/logout
GET  /clients
POST /clients
GET  /clients/:id
PATCH /clients/:id
GET  /users
POST /clients/:id/users
GET  /ad-accounts
POST /ad-accounts
GET  /dashboard/summary
GET  /dashboard/daily
GET  /dashboard/campaigns
GET  /dashboard/platform-distribution
GET  /dashboard/top-campaigns
GET  /dashboard/health
GET  /dashboard/live
POST /dashboard/sync
GET  /reports/export.csv
GET  /reports/export.pdf
POST /sync/client/:clientId
POST /sync/ad-account/:adAccountId
GET  /sync/logs
GET  /sync/status
GET  /integrations/meta/auth-url
GET  /integrations/meta/callback
```

Se algum endpoint estiver ausente, implementar sem quebrar os existentes.

---

## Integração Meta Ads

Usar somente API oficial da Meta Marketing API / Graph API.

Regras:

1. Nunca fazer scraping do Gerenciador de Anúncios.
2. Nunca expor access token no frontend.
3. Tokens devem ficar criptografados no banco.
4. Usar variável `META_API_VERSION`.
5. Implementar paginação.
6. Implementar retry/backoff.
7. Respeitar rate limits.
8. Salvar `rawActionsJson` e `rawCostPerActionJson` para auditoria.
9. Não assumir um único `action_type` para lead/conversa.
10. Permitir configuração por cliente do evento principal.

Campos esperados da Meta Insights API:

```txt
spend
impressions
reach
frequency
cpm
ctr
cpc
clicks
inline_link_clicks
actions
cost_per_action_type
date_start
date_stop
campaign_id
campaign_name
adset_id
adset_name
ad_id
ad_name
```

Criar ou revisar função `mapMetaActions(actions)` para reconhecer:

- lead
- contact
- complete_registration
- submit_application
- onsite_conversion.messaging_conversation_started_7d
- messaging_conversation_started
- purchase
- eventos customizados configurados por cliente

---

## Banco de dados e multi-tenant

Garantir isolamento por empresa/cliente.

Regras:

1. Toda consulta de cliente deve filtrar por `tenantId` ou `organizationId`.
2. Usuário cliente não pode acessar dados de outro cliente.
3. Admin pode acessar todos os clientes da empresa.
4. Super admin pode acessar tudo.
5. Tokens e logs nunca devem aparecer no frontend.
6. Criar índices para dashboard por cliente e data.
7. Se usar Supabase junto com CRM, usar schema isolado `gestao_ads`.

---

## Segurança obrigatória

- JWT com expiração
- Senha criptografada
- Rate limit no login
- CORS restrito aos domínios oficiais
- Validação de payload
- Logs sem token
- `.env` real nunca commitado
- `.env.example` completo
- Auditoria de ações críticas
- Helmet/security headers ou headers equivalentes
- Bloqueio de acesso cruzado entre clientes

---

## Frontend obrigatório

Manter identidade premium da R2R Marketing Digital.

Telas:

1. Login
2. Dashboard
3. Campanhas
4. Clientes
5. Contas de anúncio
6. Integrações
7. Relatórios
8. Alertas
9. Configurações
10. Perfil

Componentes:

- Sidebar
- Header
- Cards KPI
- Filtros de período
- Gráficos
- Tabela de campanhas
- Loading state
- Empty state
- Error state
- Botão Atualizar Dados
- Status de API online/offline

Regra do botão Atualizar Dados:

```txt
POST /dashboard/sync
```

Fluxo:

1. Exibir loading.
2. Criar sync job no backend.
3. Sincronizar Meta Ads.
4. Salvar dados no banco.
5. Recarregar resumo e campanhas.
6. Exibir erro amigável se falhar.

---

## Deploy EasyPanel

Manter compatibilidade:

```txt
Repository: RuanMarcos38/Meta-ads
Branch: main
Build Path: /
Dockerfile: Dockerfile
Porta interna: 3333
Health check: /health
```

Variáveis obrigatórias:

```env
NODE_ENV=production
PORT=3333
API_PORT=3333
APP_URL=https://gestao.r2rmarketingdigital.com.br
WEB_ORIGIN=https://gestao.r2rmarketingdigital.com.br
API_URL=https://api-gestao.r2rmarketingdigital.com.br
DATABASE_URL=postgresql://...
DATABASE_SCHEMA=gestao_ads
JWT_SECRET=troque_por_chave_forte_com_mais_de_32_caracteres
ENCRYPTION_KEY=troque_por_chave_forte_com_mais_de_32_caracteres
CORS_ORIGINS=https://gestao.r2rmarketingdigital.com.br,https://api-gestao.r2rmarketingdigital.com.br
DEMO_MODE=false
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=https://api-gestao.r2rmarketingdigital.com.br/integrations/meta/callback
META_API_VERSION=v25.0
```

---

## Deploy Hostinger Frontend

Publicar o conteúdo de `apps/web` no `public_html` do subdomínio:

```txt
gestao.r2rmarketingdigital.com.br
```

Confirmar em `apps/web/config.js`:

```js
window.APP_CONFIG = {
  API_BASE_URL: 'https://api-gestao.r2rmarketingdigital.com.br',
  DEMO_MODE: false,
  LIVE_REFRESH_MS: 15000
};
```

---

## Testes obrigatórios

Executar antes de finalizar:

```bash
npm install
npm run prisma:generate
npm run lint
npm run typecheck
npm run test
npm run build
```

Se falhar, corrigir antes de commitar.

Testar URLs:

```txt
https://api-gestao.r2rmarketingdigital.com.br/health
https://api-gestao.r2rmarketingdigital.com.br/ready
https://api-gestao.r2rmarketingdigital.com.br/api/config
https://api-gestao.r2rmarketingdigital.com.br/dashboard/live
```

---

## GitHub Actions

Garantir workflows para:

- install
- lint
- typecheck
- test
- build
- docker build
- deploy opcional quando secrets existirem

Se as secrets não existirem, o workflow deve pular deploy ou falhar com mensagem clara.

---

## Critérios de aceite

A solução só estará pronta quando:

1. Frontend abrir sem erro.
2. Login funcionar.
3. Backend responder `/health` e `/ready`.
4. Banco conectar via Prisma.
5. Dashboard carregar métricas.
6. Botão Atualizar Dados executar sync.
7. Cliente visualizar somente seus próprios dados.
8. Admin cadastrar clientes e usuários.
9. Integração Meta ficar preparada com OAuth.
10. Tokens ficarem criptografados.
11. PDF/CSV funcionar.
12. Dockerfile funcionar no EasyPanel.
13. README e README-HOSTINGER estiverem atualizados.
14. Nenhuma credencial real estiver commitada.
15. GitHub Actions estiver configurado.

---

## Não fazer

- Não usar GitHub como banco de dados.
- Não expor token Meta no frontend.
- Não usar scraping.
- Não quebrar o frontend Hostinger existente.
- Não apagar arquivos sem necessidade.
- Não deixar botão sem função.
- Não deixar senha padrão ativa em produção.
- Não commitar `.env` real.
- Não misturar dados de clientes.

---

## Entrega final esperada

Entregar o projeto Gestão Ads como SaaS profissional da R2R Marketing Digital, com painel de cliente, integração Meta Ads oficial, sincronização de métricas, backend seguro, deploy em EasyPanel, frontend na Hostinger, banco PostgreSQL/Supabase isolado e GitHub Actions para atualização controlada do repositório.
