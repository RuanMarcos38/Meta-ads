# Gestão Ads — R2R Marketing Digital

Solução SaaS para clientes acompanharem campanhas de tráfego pago, com foco em Meta Ads.

## Stack

- Backend: Node 20, TypeScript, Fastify, Prisma, PostgreSQL, JWT, Argon2
- Frontend: React 18, Vite, TypeScript, Tailwind, Recharts, Axios, Zustand
- Infra: Docker, Docker Compose, GitHub Actions
- Meta Ads: integração preparada com Marketing/Graph API oficial

## Rodar localmente

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run prisma:generate
npm --workspace apps/api run prisma:migrate
npm run seed
npm run dev:api
```

Em outro terminal:

```bash
npm run dev:web
```

Login demo:

```txt
admin@r2rmarketingdigital.com.br
123456
```

## Produção

Backend EasyPanel:

```txt
Build Path: /
Dockerfile: Dockerfile
Porta interna: 3333
Healthcheck: /health
```

Frontend Hostinger:

```bash
cd apps/web
npm install
npm run build
```

Suba o conteúdo de `apps/web/dist` para o `public_html` do subdomínio.

## URLs esperadas

```txt
Frontend: https://gestao.r2rmarketingdigital.com.br
API: https://api-gestao.r2rmarketingdigital.com.br
Health: https://api-gestao.r2rmarketingdigital.com.br/health
```

## Observação

Com `DEMO_MODE=true`, o dashboard funciona com dados simulados. Para produção real, defina `DEMO_MODE=false` e configure `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `DATABASE_URL`, `JWT_SECRET` e `ENCRYPTION_KEY`.
