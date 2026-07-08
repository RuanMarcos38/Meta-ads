# Backend Gestão Ads

## Local

```bash
cd apps/api
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run dev
```

API local:

```txt
http://localhost:3333/health
```

## EasyPanel

Use:

```txt
Build Path: /
Dockerfile: Dockerfile
Port: 3333
```

O Dockerfile raiz aponta para `apps/api`, instala dependências, executa `prisma generate`, compila TypeScript e inicia com `npm start`.

## Produção

Configure as variáveis de `apps/api/.env.example` no painel da hospedagem. Nunca envie `.env` real para o GitHub.
