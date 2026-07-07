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
- Exportacao CSV e PDF.
- OAuth preparado para Meta Ads e Google Ads.
- Sincronizacao manual e recorrente com logs e locks.
- Tokens de integracao criptografados no banco.
- Dockerfile raiz para EasyPanel usando build path `/`.
- Migration Prisma inicial organizada.
- Backup logico dos pacotes originais criado em `backup-original` durante a preparacao local.

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

Padrao do `.env.example`:

```text
admin@r2rmarketingdigital.com.br / 123456
```

Opcao 2, bootstrap:

```bash
curl -X POST http://localhost:3333/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d "{\"tenantName\":\"R2R Marketing Digital\",\"name\":\"Administrador\",\"email\":\"admin@r2rmarketingdigital.com.br\",\"password\":\"123456\"}"
```

Troque a senha imediatamente em producao.

## EasyPanel

Crie o app do backend com:

```text
Build Path: /
Dockerfile: Dockerfile
Porta: 3333
```

Configure as variaveis de ambiente com base em `.env.example`.

Na inicializacao do container, o Dockerfile executa `npm run migrate` e depois `npm run start`, garantindo que as migrations Prisma sejam aplicadas antes da API escutar na porta 3333.

## Hostinger

Publique o conteudo de `apps/web` diretamente em `public_html` do subdominio `gestao.r2rmarketingdigital.com.br`.

Edite `apps/web/config.js`:

```js
window.APP_CONFIG = {
  API_BASE_URL: 'https://api-gestao.r2rmarketingdigital.com.br',
  DEMO_MODE: false
};
```

## Credenciais externas

Meta Ads e Google Ads dependem de apps oficiais, tokens e aprovacao de API. Sem essas credenciais, os endpoints ficam preparados e o modo demo pode ser ligado apenas para validacao visual.

Mais detalhes em `README-BACKEND.md`, `docs/DEPLOY-HOSTINGER.md` e `docs/SECURITY-AUDIT.md`.
