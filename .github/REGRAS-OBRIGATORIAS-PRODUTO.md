# Regras obrigatórias do Gestão Ads

Estas regras são uma baseline de produto e devem ser preservadas em toda evolução futura.

1. **Idioma:** toda interface criada ou alterada deve usar português do Brasil (`pt-BR`). Nomes próprios de plataformas, nomes de campanhas, domínios, identificadores, eventos personalizados e códigos técnicos devem ser preservados quando a tradução puder corromper a identificação do dado.
2. **Estrutura protegida:** não remover, renomear ou substituir rotas, módulos, integrações, banco, autenticação, escopos ou componentes existentes sem uma migração compatível e validação automatizada.
3. **Credenciais imutáveis:** não alterar, expor, versionar ou substituir tokens, chaves, secrets, Client IDs, Client Secrets, senhas, URLs sensíveis ou credenciais existentes. Novos módulos devem reutilizar os mecanismos seguros já instalados.
4. **Isolamento:** todo dado deve respeitar organização, empresa, Gerenciador de Negócios e conta de anúncios autorizada. Nenhum usuário pode visualizar dados de outra empresa fora do seu escopo.
5. **Dados reais:** não criar números fictícios, saldos estimados ou históricos inventados. Quando uma API não disponibilizar um dado, a interface deve declarar a limitação de forma clara.
6. **Financeiro em todos os painéis:** com uma empresa selecionada, a interface global deve apresentar o saldo financeiro disponível das contas de anúncios Meta autorizadas, com atualização automática e acesso ao histórico financeiro/recargas que a API oficial disponibilizar.
7. **Google Analytics:** permitir escolher qualquer propriedade GA4 acessível pela conta Google conectada, sem obrigar a troca da propriedade padrão; permitir separar e filtrar os relatórios por site/domínio quando a propriedade possuir mais de um hostname.
8. **Google Ads:** mostrar dados reais de mídia disponíveis pela integração. Saldo de pagamentos e faturamento só podem aparecer quando forem retornados por uma integração oficial compatível; nunca inferir esses valores a partir do investimento.
9. **Presença no atendimento:** o chat deve indicar quem está online, mantendo as regras de permissão entre administradores e usuários da mesma empresa.
10. **Atualização:** dados de desempenho devem continuar com atualização automática; saldos financeiros devem ter atualização frequente e botão de atualização manual.
11. **Entrega segura:** toda mudança deve passar por typecheck, testes e build antes do merge em `main`. O deploy deve reutilizar os workflows e a configuração existentes, sem substituir credenciais de GitHub, EasyPanel ou hospedagem.
12. **Compatibilidade:** novas funcionalidades devem ser aditivas e não podem danificar outros projetos, serviços ou módulos já funcionando.
13. **Acesso multiempresa:** Cliente ou Gestor pode ser vinculado a mais de uma empresa no mesmo usuário. O vínculo legado `Empresa + BM principal` deve ser preservado como padrão e as empresas adicionais devem ser apenas aditivas. Ao alternar de empresa, o usuário só pode acessar BMs e contas de anúncios já autorizadas dentro das empresas explicitamente vinculadas ao seu acesso; nenhum vínculo adicional pode ampliar o escopo para empresas não selecionadas.
