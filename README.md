# Gestao Ads - R2R Marketing Digital

SaaS multi-cliente para gestor de trafego entregar a cada cliente um painel privado com resultados de Meta Ads e Google Ads.

Status: backend em revisao de producao com isolamento por empresa.

O frontend aprovado da Hostinger foi preservado em `apps/web`. O backend fica em `apps/api` e roda em Node.js, Fastify, TypeScript, Prisma e PostgreSQL.

## O que esta incluido

- Autenticacao JWT com senha criptografada.
- Perfis `SUPER_ADMIN`, `COMPANY_ADMIN`, `MANAGER` e `USER`, com compatibilidade para `ADMIN` e `CLIENT`.
- Isolamento por `tenantId` e `clientId`.
- Feature flags por empresa para `integrations`, `reports` e `sync`.
- Cadastro de clientes, usuarios e contas de anuncio.
- Dashboard com resumo, diarios, campanhas, distribuicao por plataforma e saude.
- Monitoramento ao vivo via API em `/dashboard/live`.
- Exportacao CSV e PDF.
- OAuth preparado para Meta Ads e Google Ads.
- Sincronizacao manual e recorrente com logs e locks.
- Tokens de integracao criptografados no banco.
- Dockerfile raiz para EasyPanel usando build path `/`.
- Prisma schema com fallback de primeiro deploy usando `prisma db push` quando ainda nao houver migrations.

## Sobre banco de dados e GitHub

GitHub nao deve ser usado como banco de dados para acompanhamento online ao vivo. Ele deve ficar somente como repositorio de codigo. Dados de clientes, metricas, contas de anuncio, sincronizacoes e logs devem ficar no PostgreSQL acessado pelo backend Prisma.

O acompanhamento ao vivo funciona assim:

```text
Frontend Hostinger -> Backend Fastify -> PostgreSQL/Prisma -> Meta Ads/Google Ads
```

O frontend consulta `/dashboard/live` a cada 15 segundos para mostrar se o painel esta online, se o banco esta respondendo e se existem sincronizacoes em andamento.

## Rodar localmente

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run migrate
npm run seed
npm run dev
```

API:

```text
http://localhost:3333/health
http://localhost:3333/ready
```

Tambem existem aliases para facilitar testes de hospedagem:

```text
/api/health
/api/ready
/api/config
/dashboard/live
```

Frontend estatico:

Abra `apps/web/index.html` ou publique os arquivos em uma hospedagem estatica. Para usar dados reais, edite `apps/web/config.js`.

## Testes e build

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Primeiro admin

Opcao 1, seed:

```bash
npm run seed
```

No EasyPanel, rode o seed somente depois do banco estar criado e troque `SEED_ADMIN_PASSWORD` antes de executar.

Opcao 2, bootstrap:

```bash
curl -X POST https://api-gestao.r2rmarketingdigital.com.br/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d "{\"tenantName\":\"R2R Marketing Digital\",\"name\":\"Administrador\",\"email\":\"admin@r2rmarketingdigital.com.br\",\"password\":\"TROQUE_POR_SENHA_FORTE\"}"
```

Troque a senha imediatamente em producao.

## EasyPanel

Crie o app do backend com:

```text
Repositorio: RuanMarcos38/Meta-ads
Branch: main
Build Path: /
Dockerfile: Dockerfile
Porta interna: 3333
Health check: /health
```

Configure as variaveis de ambiente com base em `.env.example`.

Obrigatorias:

```text
NODE_ENV=production
PORT=3333
API_PORT=3333
APP_URL=https://gestao.r2rmarketingdigital.com.br
WEB_ORIGIN=https://gestao.r2rmarketingdigital.com.br
API_URL=https://api-gestao.r2rmarketingdigital.com.br
DATABASE_URL=postgresql://...
JWT_SECRET=mais_de_32_caracteres
ENCRYPTION_KEY=mais_de_32_caracteres
CORS_ORIGINS=https://gestao.r2rmarketingdigital.com.br,https://api-gestao.r2rmarketingdigital.com.br
DEMO_MODE=false
```

Na inicializacao do container, o Dockerfile executa `npm run migrate` e depois `npm run start`. O script de migration tenta `prisma migrate deploy` e, se ainda nao houver migrations, usa `prisma db push` para criar o schema do primeiro deploy.

Teste depois do deploy:

```text
https://api-gestao.r2rmarketingdigital.com.br/health
https://api-gestao.r2rmarketingdigital.com.br/ready
https://api-gestao.r2rmarketingdigital.com.br/api/config
```

Depois de logado, teste o status ao vivo:

```text
https://api-gestao.r2rmarketingdigital.com.br/dashboard/live
```

## Hostinger

Publique o conteudo de `apps/web` diretamente em `public_html` do subdominio `gestao.r2rmarketingdigital.com.br`.

Edite `apps/web/config.js`:

```js
window.APP_CONFIG = {
  API_BASE_URL: 'https://api-gestao.r2rmarketingdigital.com.br',
  DEMO_MODE: false,
  LIVE_REFRESH_MS: 15000
};
```

## Credenciais externas

Meta Ads e Google Ads dependem de apps oficiais, tokens e aprovacao de API. Sem essas credenciais, os endpoints ficam preparados e o modo demo pode ser ligado apenas para validacao visual.

Mais detalhes em `README-BACKEND.md`, `docs/DEPLOY-HOSTINGER.md` e `docs/SECURITY-AUDIT.md`.
