# Engine Admin · catálogo de produção · fase 1

[Issue #52](https://github.com/menezeed/vivere-engine/issues/52) · [Contrato e paridade do legado, PR #54](https://github.com/menezeed/vivere-engine/pull/54)

## QA com dados sintéticos

1. Inicie a Review API local com a configuração de autenticação de staging existente e `CATALOG_MODE=fixture`.
2. Inicie o Vite do `admin-panel` com `VITE_CATALOG_ENABLED=true`. A flag é desligada por omissão e só tem efeito em desenvolvimento.
3. Entre com uma conta de teste autorizada para a Review API. Abra **Catálogo de produção** e confirme o banner **DADOS SINTÉTICOS — SOMENTE LEITURA**.
4. Confira busca, filtros de categoria e estado do Engine, vínculo de local nas atividades, paginação, lista vazia e detalhe com completude. Confirme também catálogo desativado, filtros inválidos, sessão expirada, falta de papel e indisponibilidade.
5. Remova a flag e reinicie o Vite. O menu e a rota desaparecem. `CATALOG_MODE=disabled` desliga o backend de catálogo.

O frontend usa o JWT da sessão de staging somente na Review API. A autorização segue SEC-A/SEC-B do contrato e o encaminhamento ao Supabase é responsabilidade do backend. Cada pedido de catálogo declara `expected_target=fixture`. O backend rejeita uma fonte diferente antes da leitura e o cliente também verifica o ambiente da resposta. As telas de propostas e o CRUD legado permanecem operacionais.

Execute `npx vitest run admin-panel/tests/catalogAdminClient.test.ts src/review-api/catalog/__tests__/catalogRoutes.test.ts` na raiz. Os testes usam fixtures e identidade sintética.

## Conexão futura

A primeira leitura de produção exige autorização específica do PO e validação isolada do modo fixture. Uma revisão posterior deverá habilitar explicitamente a origem produtiva, preservar a proteção por modo e exibir **PRODUÇÃO — SOMENTE LEITURA** conforme o ambiente confirmado pelo backend. Cadastro, edição, publicação e corte operacional permanecem nas fases descritas no contrato.
