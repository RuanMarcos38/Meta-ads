# Deploy Hostinger - Frontend Gestao Ads

O frontend aprovado fica em:

```text
apps/web
```

Arquivos que devem ficar diretamente dentro de `public_html`:

```text
index.html
config.js
.htaccess
assets/api.js
assets/app.js
assets/styles.css
```

## Publicacao

1. Acesse Hostinger > Gerenciador de Arquivos.
2. Abra o `public_html` do subdominio `gestao.r2rmarketingdigital.com.br`.
3. Faca backup dos arquivos antigos.
4. Envie o conteudo de `apps/web`.
5. Confirme que `index.html` esta diretamente dentro de `public_html`.
6. Edite `config.js`.

## Config real

```js
window.APP_CONFIG = {
  APP_NAME: 'Gestao Ads',
  COMPANY_NAME: 'R2R Marketing Digital',
  API_BASE_URL: 'https://api-gestao.r2rmarketingdigital.com.br',
  DEMO_MODE: false,
  DEFAULT_LOGIN: {
    email: 'admin@r2rmarketingdigital.com.br',
    password: '123456'
  },
  WHATSAPP_SUPPORT: '5547996753735'
};
```

## Modo demo

Use apenas para teste visual:

```js
DEMO_MODE: true
```

Em producao, deixe `DEMO_MODE: false`.
