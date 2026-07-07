# Gestão Ads API - EasyPanel V7

Versão de estabilidade para subir a API no EasyPanel antes de conectar banco, Meta Ads e Google Ads reais.

## Configuração no EasyPanel

- Fonte: Upload
- Construção: Dockerfile
- Caminho do Dockerfile: Dockerfile
- Porta interna: 3333 ou 3000
- Health check: /health

## Variáveis mínimas

NODE_ENV=production
PORT=3333
API_PORT=3333
WEB_ORIGIN=https://gestao.r2rmarketingdigital.com.br
DEMO_MODE=true
META_GRAPH_VERSION=v20.0
META_APP_ID=2311855156219805
META_APP_SECRET=SUA_CHAVE_SECRETA_REAL_DA_META
META_REDIRECT_URI=https://api-gestao.r2rmarketingdigital.com.br/integrations/meta/callback

## Testes

https://api-gestao.r2rmarketingdigital.com.br/
https://api-gestao.r2rmarketingdigital.com.br/health
https://api-gestao.r2rmarketingdigital.com.br/integrations/meta/callback

## Login demo

E-mail: admin@r2rmarketingdigital.com.br
Senha: 123456
