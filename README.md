# Gestão Ads — R2R Marketing Digital

Solução SaaS para clientes acompanharem campanhas e métricas de tráfego pago, com foco inicial em Meta Ads.

## Stack

- Backend: Node.js 20, TypeScript, Fastify, Prisma, PostgreSQL, JWT e Argon2
- Frontend: React 18, Vite, TypeScript, Tailwind, Recharts, Axios e Zustand
- Infra: Docker, EasyPanel, Hostinger e GitHub Actions
- Dados: Supabase PostgreSQL

## Isolamento obrigatório

Este repositório está autorizado a usar somente:

```text
GitHub: RuanMarcos38/Meta-ads
Supabase: CRM R2 MARKETING DIGITAL
Project ref: iqrnytsgwaiegddfxfjs
Schema: gestao_ads
```

O backend bloqueia a inicialização quando `DATABASE_SCHEMA` é diferente de `gestao_ads`. O schema `public` do CRM não deve ser alterado, apagado ou reutilizado por esta aplicação.

A migration versionada está em:

```text
supabase/migrations/20260712140000_create_gestao_ads_isolated_schema.sql
```

## Rodar localmente

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run prisma:generate
npm --workspace apps/api run prisma:push
npm run seed
npm run dev:api
```

Em outro terminal:

```bash
npm run dev:web
```

Em desenvolvimento, o seed aceita a senha de demonstração somente quando `NODE_ENV` não é `production`. Em produção, `SEED_ADMIN_PASSWORD` é obrigatória e precisa ter pelo menos 12 caracteres.

## Backend no EasyPanel

```text
Repository: RuanMarcos38/Meta-ads
Branch: main
Build Path: /
Dockerfile: Dockerfile
Porta interna: 3333
Healthcheck: /health
Domínio: api-gestao.r2rmarketingdigital.com.br
```

O container executa:

1. Instalação das dependências.
2. `prisma generate`.
3. Build TypeScript.
4. Validação das variáveis de produção.
5. Sincronização exclusiva do schema `gestao_ads`.
6. Inicialização da API na porta 3333.

Use `apps/api/.env.example` como referência. As variáveis essenciais são:

```env
NODE_ENV=production
PORT=3333
DATABASE_SCHEMA=gestao_ads
DATABASE_URL=postgresql://postgres:<SENHA>@db.iqrnytsgwaiegddfxfjs.supabase.co:5432/postgres?sslmode=require&schema=gestao_ads
DIRECT_URL=postgresql://postgres:<SENHA>@db.iqrnytsgwaiegddfxfjs.supabase.co:5432/postgres?sslmode=require&schema=gestao_ads
JWT_SECRET=<CHAVE_FORTE>
JWT_REFRESH_SECRET=<OUTRA_CHAVE_FORTE>
ENCRYPTION_KEY=<64_CARACTERES_HEXADECIMAIS>
CORS_ORIGINS=https://gestao.r2rmarketingdigital.com.br
DEMO_MODE=false
```

Nunca reutilize secrets de outros projetos e nunca envie um arquivo `.env` real ao GitHub.

## Primeiro administrador

No primeiro deploy, configure temporariamente:

```env
RUN_SEED_ON_START=true
SEED_ADMIN_NAME=Administrador R2R
SEED_ADMIN_EMAIL=admin@r2rmarketingdigital.com.br
SEED_ADMIN_PASSWORD=<SENHA_FORTE_COM_12_OU_MAIS_CARACTERES>
SEED_DEMO_CLIENT=false
```

Depois do primeiro login, altere `RUN_SEED_ON_START=false` e faça um novo deploy.

## Frontend na Hostinger

Para o frontend React/Vite:

```bash
cd apps/web
npm install
VITE_API_BASE_URL=https://api-gestao.r2rmarketingdigital.com.br npm run build
```

Suba o conteúdo de `apps/web/dist` para o `public_html` do subdomínio `gestao.r2rmarketingdigital.com.br`.

O pacote estático existente na raiz também usa:

```text
API_BASE_URL=https://api-gestao.r2rmarketingdigital.com.br
DEMO_MODE=false
```

## URLs esperadas

```text
Frontend: https://gestao.r2rmarketingdigital.com.br
API: https://api-gestao.r2rmarketingdigital.com.br
Health: https://api-gestao.r2rmarketingdigital.com.br/health
```

O `/health` deve informar:

```json
{
  "data": {
    "status": "ok",
    "database": "connected",
    "schema": "gestao_ads"
  }
}
```

## Segurança aplicada

- Tokens Meta ficam criptografados no banco.
- Secrets ficam apenas no backend.
- CORS é restrito ao frontend de produção.
- `CLIENT` acessa somente o próprio `clientId`.
- `MANAGER` acessa somente o cliente atribuído.
- Senhas padrão foram removidas da produção.
- O frontend renova a sessão por refresh token.
- O healthcheck testa a conexão real com o PostgreSQL.
- Erros de produção não expõem stack trace ou detalhes internos da Meta.

## Validação antes de publicar

```bash
npm run typecheck
npm test
npm run build
```

Depois valide login, dashboard, isolamento de clientes, sincronização Meta e `/health` em produção.
