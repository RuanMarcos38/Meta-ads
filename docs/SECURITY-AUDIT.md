# Auditoria de Seguranca - Multi-tenant, RBAC e Feature Flags

Data: 2026-07-07

## 1. RBAC incompleto

- Problema: o backend tinha apenas `ADMIN`, `MANAGER` e `CLIENT`, sem os niveis solicitados de Super Admin, Administrador da Empresa, Gestor e Usuario Comum.
- Impacto: a API nao distinguia administracao global, administracao da empresa e usuario comum moderno.
- Risco de seguranca: permissoes amplas demais ou inconsistentes por acao.
- Arquivos afetados: `apps/api/prisma/schema.prisma`, `apps/api/src/services/accessControl.ts`, `apps/api/src/routes/users.ts`, `apps/api/src/routes/clients.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/seed.ts`.
- Correcao realizada: adicionados `SUPER_ADMIN`, `COMPANY_ADMIN` e `USER`; mantidos `ADMIN` e `CLIENT` como compatibilidade. Criada hierarquia centralizada de papeis e validacao por acao.
- Como testar: executar `npm run test`; tentar criar `COMPANY_ADMIN` com um `MANAGER` deve retornar 403; tentar criar `USER` com `MANAGER` deve permitir.

## 2. IDOR por troca de clientId

- Problema: rotas como `PATCH /users/:id`, `PATCH /ad-accounts/:id`, filtros de integracoes e logs aceitavam `clientId` sem validacao central em todos os pontos.
- Impacto: um usuario autenticado poderia tentar vincular ou consultar recursos manipulando IDs manualmente.
- Risco de seguranca: acesso indireto ou associacao indevida de dados de outro cliente/tenant.
- Arquivos afetados: `apps/api/src/services/tenantScope.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/routes/users.ts`, `apps/api/src/routes/adAccounts.ts`, `apps/api/src/routes/integrations.ts`, `apps/api/src/routes/sync.ts`.
- Correcao realizada: criado `assertTenantClient`; toda entrada de `clientId` sensivel valida `id + tenantId` antes de consultar, atualizar ou sincronizar.
- Como testar: autenticar em um tenant e chamar endpoints com `clientId` de outro tenant; a API deve retornar 404/403 e nao alterar dados.

## 3. Usuario comum nao era tratado no escopo de cliente

- Problema: somente `CLIENT` era forçado a usar o `clientId` vinculado ao usuario.
- Impacto: o novo papel `USER` poderia cair no fluxo de usuarios internos se fosse adicionado sem ajustar o middleware.
- Risco de seguranca: usuario comum poderia consultar clientes do tenant inteiro.
- Arquivos afetados: `apps/api/src/services/accessControl.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/routes/clients.ts`, `apps/web/assets/app.js`.
- Correcao realizada: `USER` e `CLIENT` agora sao papeis escopados a cliente; `resolveClientScope` ignora `clientId` manipulado por usuario comum e usa o vinculo autenticado.
- Como testar: logar com `USER`, chamar `/clients` e `/dashboard/summary?clientId=outro-id`; a API deve retornar somente o cliente vinculado.

## 4. Feature flags inexistentes

- Problema: nao havia estrutura para liberar ou bloquear funcionalidades por empresa.
- Impacto: menus poderiam ser escondidos no frontend, mas a API nao teria bloqueio equivalente.
- Risco de seguranca: acesso a funcionalidades contratualmente desativadas por chamadas diretas ao backend.
- Arquivos afetados: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20260707090000_security_rbac_feature_flags/migration.sql`, `apps/api/prisma/migrations/20260707091000_feature_flags_defaults/migration.sql`, `apps/api/src/services/features.ts`, `apps/api/src/routes/featureFlags.ts`, `apps/api/src/routes/reports.ts`, `apps/api/src/routes/integrations.ts`, `apps/api/src/routes/sync.ts`, `apps/web/assets/app.js`.
- Correcao realizada: criada tabela `feature_flags`; `GET /feature-flags` lista flags do tenant; `PUT /feature-flags/:featureName` altera flags para administradores; backend bloqueia `reports`, `integrations` e `sync` quando desativados.
- Como testar: `PUT /feature-flags/reports {"enabled":false}` e depois chamar `/reports/export.csv`; deve retornar 403 e o menu deve sumir no frontend apos recarregar.

## 5. Protecao por tela sem espelho no backend

- Problema: o frontend tinha logica simples para diferenciar `ADMIN/MANAGER` de `CLIENT`, sem considerar novos papeis e sem ler flags.
- Impacto: telas podiam aparecer para perfis errados ou permanecer visiveis quando uma feature estivesse desativada.
- Risco de seguranca: confusao de permissao e tentativa de acesso direto por usuario sem direito.
- Arquivos afetados: `apps/web/assets/app.js`.
- Correcao realizada: frontend reconhece `SUPER_ADMIN`, `COMPANY_ADMIN`, `ADMIN`, `MANAGER`, `USER` e `CLIENT`; menus de integracoes e relatorios respeitam flags; seletor de cliente fica bloqueado para `USER/CLIENT`.
- Como testar: desativar `integrations` ou `reports`; recarregar o painel e verificar que o menu some. Confirmar tambem que chamada direta ao endpoint retorna 403.

## Validacoes executadas

Executar antes do deploy:

```bash
npm run build
npm run lint
npm run typecheck
npm run test
npm audit --omit=dev
```

Rotas criticas para teste manual:

- `POST /auth/login`
- `GET /auth/me`
- `GET /clients`
- `GET /dashboard/summary?clientId=<id>`
- `GET /feature-flags`
- `PUT /feature-flags/reports`
- `GET /reports/export.csv?clientId=<id>`
- `GET /integrations?clientId=<id>`
- `GET /sync/logs?clientId=<id>`
