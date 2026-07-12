GESTAO ADS R2R — PUBLICACAO SEGURA

============================================================
1. REGRA DE ISOLAMENTO
============================================================

Repositorio autorizado:
RuanMarcos38/Meta-ads

Projeto Supabase autorizado:
CRM R2 MARKETING DIGITAL
Project ref: iqrnytsgwaiegddfxfjs

Schema exclusivo desta aplicacao:
gestao_ads

NAO usar, apagar, renomear ou alterar tabelas do schema public.
NAO reutilizar secrets, containers, dominios ou bancos de outros projetos.

============================================================
2. FRONTEND NA HOSTINGER
============================================================

Dominio:
https://gestao.r2rmarketingdigital.com.br

Arquivos do pacote estatico atual:
- index.html
- config.js
- .htaccess
- assets/styles.css
- assets/app.js

Instalacao:
1. Abra o public_html do subdominio gestao.r2rmarketingdigital.com.br.
2. Salve os arquivos antigos em uma pasta de backup.
3. Envie os arquivos acima diretamente para o public_html.
4. Confirme no config.js:
   API_BASE_URL: 'https://api-gestao.r2rmarketingdigital.com.br'
   DEMO_MODE: false
5. Limpe o cache do navegador com CTRL + F5.

Nao existe mais senha padrao de producao no repositorio.

============================================================
3. BACKEND NO EASYPANEL
============================================================

Criar uma aplicacao separada, sem reaproveitar servicos de outros projetos.

Repository: RuanMarcos38/Meta-ads
Branch: main
Build Path: /
Dockerfile: Dockerfile
Porta interna: 3333
Healthcheck path: /health
Dominio: api-gestao.r2rmarketingdigital.com.br
HTTPS: ativo

O Dockerfile:
- instala as dependencias do backend;
- executa prisma generate;
- compila o TypeScript;
- obriga o schema gestao_ads;
- sincroniza somente esse schema;
- inicia a API na porta 3333;
- valida banco e API pelo /health.

============================================================
4. VARIAVEIS DO EASYPANEL
============================================================

NODE_ENV=production
PORT=3333
DATABASE_SCHEMA=gestao_ads
PRISMA_DB_PUSH=true

DATABASE_URL=postgresql://postgres:<SENHA_DO_BANCO>@db.iqrnytsgwaiegddfxfjs.supabase.co:5432/postgres?sslmode=require&schema=gestao_ads
DIRECT_URL=postgresql://postgres:<SENHA_DO_BANCO>@db.iqrnytsgwaiegddfxfjs.supabase.co:5432/postgres?sslmode=require&schema=gestao_ads

JWT_SECRET=<CHAVE_FORTE_COM_32_OU_MAIS_CARACTERES>
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<OUTRA_CHAVE_FORTE_COM_32_OU_MAIS_CARACTERES>
JWT_REFRESH_EXPIRES_IN=7d
ENCRYPTION_KEY=<64_CARACTERES_HEXADECIMAIS>

FRONTEND_URL=https://gestao.r2rmarketingdigital.com.br
API_PUBLIC_URL=https://api-gestao.r2rmarketingdigital.com.br
CORS_ORIGINS=https://gestao.r2rmarketingdigital.com.br
DEMO_MODE=false

META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=https://api-gestao.r2rmarketingdigital.com.br/meta/oauth/callback
META_API_VERSION=v21.0

Gerar ENCRYPTION_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Gerar JWT_SECRET e JWT_REFRESH_SECRET separadamente. Nunca reutilizar as chaves do CRM.
Caso a senha do Supabase tenha caracteres especiais, codifique-os para URL.

============================================================
5. PRIMEIRO ADMINISTRADOR
============================================================

No primeiro deploy, configurar temporariamente:

RUN_SEED_ON_START=true
SEED_ADMIN_NAME=Administrador R2R
SEED_ADMIN_EMAIL=admin@r2rmarketingdigital.com.br
SEED_ADMIN_PASSWORD=<SENHA_FORTE_COM_12_OU_MAIS_CARACTERES>
SEED_DEMO_CLIENT=false

Depois que o deploy concluir e o login funcionar, alterar:

RUN_SEED_ON_START=false

A senha nao e exibida nos logs e nao deve ser salva no GitHub.

============================================================
6. VALIDACAO
============================================================

Abrir:
https://api-gestao.r2rmarketingdigital.com.br/health

Resposta esperada:
- status: ok
- database: connected
- schema: gestao_ads

Depois validar:
1. Login no frontend.
2. Dashboard protegido.
3. Cadastro de cliente.
4. Usuario CLIENT vendo somente o proprio cliente.
5. Usuario MANAGER vendo somente o cliente atribuido.
6. Sincronizacao Meta sem DEMO_MODE.

Se /health retornar DATABASE_UNAVAILABLE, revisar DATABASE_URL, DIRECT_URL, senha, SSL e acesso de rede ao Supabase.
