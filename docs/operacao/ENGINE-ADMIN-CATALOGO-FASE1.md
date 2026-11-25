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

## Validação integrada em staging

Reutilizar o [CI do commit `b9a2f3f`](https://github.com/menezeed/vivere-engine/actions/runs/45669484744) e os 32 testes direcionados aprovados. O aceite abaixo cobre a configuração externa e a sessão real de staging.

### Pré-requisitos do operador de staging

| Gate | Configuração e evidência mínima | Estado |
| --- | --- | --- |
| HTTPS | Duas origens isoladas, painel e Review API, com hostnames efetivos e certificados confiáveis para o navegador. Registrar as origens e `GET /health` → 200 via HTTPS, sem ignorar TLS. | Pendente de evidência |
| Conta de teste | Conta preexistente e dedicada no Auth de staging, com `app_metadata.role=viewer` atribuído por operador autorizado. Após eventual atribuição, iniciar sessão nova para carregar a claim. Registrar apenas PASS/FAIL, sem identificadores, credenciais ou JWT. | Pendente de evidência |
| CORS | `CORS_ORIGIN` é uma única origem HTTPS exata do painel, sem caminho, barra final ou wildcard. `VITE_API_BASE_URL` é a origem HTTPS exata da Review API, sem barra final. Registrar preflight do painel permitido e ausência de origem autorizada para um domínio não permitido. | Pendente de evidência |
| Isolamento | Review API com `VIVERE_ENV=staging`, `SUPABASE_URL` de staging e `CATALOG_MODE=fixture`. Nenhuma variável `CATALOG_PROD_*` presente. O Auth do Vite aponta para o mesmo projeto de staging, com chave pública; a chave de serviço existente fica exclusivamente no servidor. | A confirmar no processo de teste |

A flag existente só funciona no servidor Vite de desenvolvimento. Para o ensaio HTTPS deste PR, use uma instância isolada e restrita a operadores, com TLS no proxy aprovado à frente do Vite e da Review API. Encaminhe apenas os hosts previstos (incluindo WebSocket se necessário), mantenha as portas internas inacessíveis externamente e preserve a guarda do Vite. Um bundle estático não exercita esta flag.

Após confirmar as origens com o operador, execute em PowerShell. Estes pedidos prescindem de conta e só verificam transporte e CORS.

```powershell
$stagingAdminOrigin = Read-Host 'Origem HTTPS confirmada do Admin de staging'
$stagingApiOrigin = Read-Host 'Origem HTTPS confirmada da Review API de staging'

curl.exe --proto '=https' --silent --show-error --fail --output NUL --write-out "health HTTP %{http_code}`n" "$stagingApiOrigin/health"
foreach ($candidateOrigin in @($stagingAdminOrigin, 'https://nao-autorizado.invalid')) {
  curl.exe --proto '=https' --silent --show-error --dump-header - --output NUL --request OPTIONS `
    --header "Origin: $candidateOrigin" `
    --header 'Access-Control-Request-Method: GET' `
    --header 'Access-Control-Request-Headers: authorization, content-type' `
    "$stagingApiOrigin/api/catalog/activities?expected_target=fixture"
}
```

Para a origem permitida, exigir resposta 2xx com `Access-Control-Allow-Origin` exatamente igual à origem do painel, GET permitido e os cabeçalhos solicitados. Para a segunda origem, exigir ausência de autorização via `Access-Control-Allow-Origin`; um 2xx sozinho não prova que o navegador permite a leitura.

### Matriz de aceite no navegador

| Verificação | Resultado esperado |
| --- | --- |
| Sem sessão, consulta ao catálogo de staging | 401. Uma sessão válida autenticada no projeto de staging é necessária. |
| Sessão de staging sem papel aceito, se já houver conta de QA adequada | 403 no backend; o painel pode barrar antes do pedido. O papel autorizado vem de `app_metadata.role`, nunca de `user_metadata`. |
| Sessão `viewer` e flag ON | 200 em atividades, locais, categorias e detalhe. Confirmar `environment.target=fixture`, `access=read-only` e o banner **DADOS SINTÉTICOS — SOMENTE LEITURA**. |
| Pesquisa, filtros, paginação e completude | Conferir categoria, local da atividade, estado, vazio e detalhe. Se a fixture não encher uma página, conferir a paginação com um GET de staging usando `pageSize=1`. |
| RBAC e métodos | A interface não oferece ações de escrita. Reutilizar a evidência automatizada de 405 para POST/PUT/PATCH/DELETE, inclusive com papel admin. A sessão `viewer` não autoriza decisões na fila de propostas. |
| Rollback | Desativar `VITE_CATALOG_ENABLED` remove rota e menu. Em um processo de QA com `CATALOG_MODE=disabled`, um GET autenticado responde 503 `CATALOG_DISABLED`. |

Registrar SHA, horário, origens, estados HTTP e rótulo retornado. Omitir JWTs, cookies, chaves e dados pessoais, inclusive em arquivos HAR. Marcar como pendente qualquer linha sem evidência. A validação de staging encerra com fonte sintética e não autoriza a conexão produtiva.

## Conexão futura

A primeira leitura de produção exige autorização específica do PO e validação isolada do modo fixture. Uma revisão posterior deverá habilitar explicitamente a origem produtiva, preservar a proteção por modo e exibir **PRODUÇÃO — SOMENTE LEITURA** conforme o ambiente confirmado pelo backend. Cadastro, edição, publicação e corte operacional permanecem nas fases descritas no contrato.
