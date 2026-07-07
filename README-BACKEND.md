# Backend - Gestao Ads

## Stack

- Node.js 20
- Fastify
- TypeScript
- Prisma ORM
- PostgreSQL
- JWT + bcrypt
- Docker/EasyPanel

## EasyPanel

Use exatamente:

```text
Build Path: /
Dockerfile: Dockerfile
Port: 3333
```

O `Dockerfile` da raiz instala dependencias, executa `prisma generate`, compila TypeScript e inicia o backend com `npm start` dentro de `apps/api`.

## Variaveis principais

Copie `.env.example` para `.env` e configure:

```env
DATABASE_URL=postgresql://user:password@host:5432/gestao_ads
JWT_SECRET=troque-essa-chave-por-uma-string-com-mais-de-32-caracteres
ENCRYPTION_KEY=32_caracteres_obrigatorio_aqui
CORS_ORIGINS=https://gestao.r2rmarketingdigital.com.br,http://localhost:5173,http://localhost:3000
DEMO_MODE=false
```

## Banco e migrations

```bash
npm install
npm run prisma:generate
npm run migrate
npm run seed
```

No Docker Compose:

```bash
docker compose up --build
```

## Endpoints principais

- `POST /auth/bootstrap`
- `POST /auth/login`
- `GET /auth/me`
- `POST /clients`
- `GET /clients`
- `POST /clients/:id/users`
- `GET /users`
- `GET /ad-accounts`
- `POST /ad-accounts`
- `GET /dashboard/summary`
- `GET /dashboard/daily`
- `GET /dashboard/campaigns`
- `GET /dashboard/platform-distribution`
- `GET /dashboard/top-campaigns`
- `GET /dashboard/health`
- `GET /reports/export.csv`
- `GET /reports/export.pdf`
- `POST /sync/client/:clientId`
- `POST /sync/ad-account/:adAccountId`
- `GET /sync/logs`
- `GET /sync/status`
- `GET /integrations/meta/auth-url`
- `GET /integrations/meta/callback`
- `GET /integrations/google/auth-url`
- `GET /integrations/google/callback`

## Meta Ads

Configure:

```env
META_APP_ID=
META_APP_SECRET=
META_API_VERSION=v21.0
META_REDIRECT_URI=https://api-gestao.r2rmarketingdigital.com.br/integrations/meta/callback
```

Fluxo:

1. Admin chama `/integrations/meta/auth-url?clientId=...`.
2. Usuario autoriza no Facebook.
3. Callback salva token criptografado.
4. Admin lista contas e vincula com `/integrations/meta/connect-account`.
5. Sincronize com `/sync/client/:clientId` ou `/integrations/meta/sync/:clientId`.

## Google Ads

Configure:

```env
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REDIRECT_URI=https://api-gestao.r2rmarketingdigital.com.br/integrations/google/callback
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
```

Fluxo:

1. Admin chama `/integrations/google/auth-url?clientId=...`.
2. Usuario autoriza Google Ads.
3. Callback salva refresh token criptografado.
4. Admin lista contas e vincula com `/integrations/google/connect-account`.
5. Sincronize com `/sync/client/:clientId` ou `/integrations/google/sync/:clientId`.

## Seguranca multi-cliente

- `CLIENT` ignora qualquer `clientId` enviado no frontend e usa o `clientId` do token.
- `ADMIN` e `MANAGER` acessam somente clientes do proprio tenant.
- Tokens Meta/Google sao criptografados com `ENCRYPTION_KEY`.
- CORS fica restrito a `CORS_ORIGINS`.
- Logs nao expõem tokens.

## Validacao

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```
