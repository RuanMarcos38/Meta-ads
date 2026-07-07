# Deploy na Hostinger ou VPS

## Opção recomendada: VPS com Docker

1. Suba os arquivos para o servidor.
2. Copie `.env.example` para `.env`.
3. Preencha `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` e credenciais das APIs.
4. Rode:

```bash
docker compose up -d --build
```

## Domínios sugeridos

- `painel.seudominio.com.br` apontando para frontend.
- `api.seudominio.com.br` apontando para backend.

No frontend, configure:

```env
VITE_API_URL=https://api.seudominio.com.br
```

## Configurações oficiais necessárias

### Meta Ads

- Criar app no Meta Developers.
- Ativar permissões `ads_read` e `business_management`.
- Configurar URL de callback igual ao `.env`.
- Conectar conta de anúncios por cliente.

### Google Ads

- Criar projeto no Google Cloud.
- Ativar Google Ads API.
- Criar OAuth Client.
- Obter Developer Token no Google Ads.
- Usar escopo `https://www.googleapis.com/auth/adwords`.

## Segurança

- Nunca suba `.env` no GitHub.
- Use HTTPS no domínio final.
- Troque senha inicial do admin.
- Configure backup automático do PostgreSQL.
