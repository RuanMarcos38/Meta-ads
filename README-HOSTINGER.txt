FRONTEND FINAL - GESTAO ADS R2R

ARQUIVOS DO PACOTE:
- index.html
- config.js
- .htaccess
- assets/styles.css
- assets/app.js

COMO INSTALAR NA HOSTINGER:
1. Acesse Hostinger > Gerenciador de Arquivos.
2. Abra a pasta public_html do subdominio gestao.r2rmarketingdigital.com.br.
3. Apague os arquivos antigos do painel ou renomeie a pasta antiga como backup.
4. Envie os arquivos deste pacote ou sincronize pelo GitHub.
5. Confirme que os arquivos ficaram diretamente dentro de public_html:
   public_html/index.html
   public_html/config.js
   public_html/.htaccess
   public_html/assets/styles.css
   public_html/assets/app.js
6. Abra o site e use CTRL + F5 para limpar cache.

LOGIN DEMO:
E-mail: admin@r2rmarketingdigital.com.br
Senha: 123456

BACKEND/API:
O config.js ja esta apontando para:
API_BASE_URL: 'https://api-gestao.r2rmarketingdigital.com.br'
DEMO_MODE: false

Se a API ainda nao estiver publicada, altere temporariamente:
API_BASE_URL: ''
DEMO_MODE: true

Com DEMO_MODE=false, o painel autentica na API, carrega dados do dashboard e usa o botao Atualizar para chamar /dashboard/sync.

OBSERVACAO IMPORTANTE:
O index.html anexado originalmente apontava para assets gerados pelo Vite:
- /assets/index-BS6TQsKj.js
- /assets/index-pr3CyKpo.css

Como esses arquivos nao foram enviados, este pacote foi ajustado para usar:
- /assets/app.js
- /assets/styles.css

Assim o frontend fica funcional para publicacao direta na Hostinger.

REVISAO VISUAL APLICADA:
- Cards reduzidos e padronizados.
- Fontes menores e mais legiveis.
- Layout mais limpo para cliente final.
- Resumo executivo no topo.
- Tabela focada apenas nas principais informacoes.
- Melhor responsividade para desktop, notebook e celular.

BACKEND EASYPANEL:
- Repository: RuanMarcos38/Meta-ads
- Branch: main
- Build Path: /
- Dockerfile: Dockerfile
- Porta interna: 3333
- Healthcheck: /health
- Dominio API: https://api-gestao.r2rmarketingdigital.com.br
