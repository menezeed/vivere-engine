# db/audit — auditoria de privilégios e testes de acesso (SEC-O-016 / 016B)

Estado (2026-11-07): a auditoria só de leitura correu no staging
(SEC-O-017, SEC-O-019B e pós-0023) e a `0023` foi aplicada no staging
(SEC-O-020, 8/8). SEC-O-021 (concluída): nova auditoria só de leitura
idêntica ao estado pós-0023 (391/391 linhas, 0 diferenças, 8/8) e
verificações HTTP só GET/HEAD `TOTAL 13/13` no staging. Nada foi
executado em produção. Os testes de acesso SQL e os testes HTTP que
escrevem dados **não** foram executados em nenhum Supabase. Cada execução
remota precisa de um REF próprio do Level 2.

Lote 2: a auditoria passou a **v2** (desenho pós-0024/0025: interesses só
por RPC, sem UPDATE de `anon` em `activities` — `authenticated` mantém-no
para o admin —, `active_activities` só SELECT, `activity_interests` sem
nenhum privilégio) e os
testes de acesso passaram a 61 (escrita directa negada + RPC). A v1 fica
congelada nas evidências SEC-O; `local/compare-audits.mjs` continua a ser
a ferramenta da 0023 sobre a v1 (espera `PENDENTE`=7). 0024/0025 só foram
validadas na simulação local.

| Ficheiro | Natureza | Onde |
|---|---|---|
| `grants-audit.readonly.sql` | Uma única instrução `SELECT` sobre o catálogo. Não lê linhas da aplicação nem escreve (provado numa sessão `default_transaction_read_only`). | Staging **e** produção, em separado |
| `mobile-access-tests.staging.sql` | 61 testes positivos e negativos como `anon`/`authenticated`, com fixtures sintéticas. Termina sempre com `RAISE EXCEPTION`, que desfaz tudo. | **Só staging** |
| `local/supabase-sim.sql` | Simulação mínima do Supabase (papéis, schema `auth` com `users`, `sessions`, `identities`, `refresh_tokens` e FK em cascata, default ACL). | **Só PostgreSQL local descartável** |
| `local/activity-interests-requirements.local.sql` | Experiência dos privilégios exigidos pelo upsert de interesses. Recusa correr fora da simulação. | **Só local** |
| `local/lote2-rpc-tests.local.sql` | 79 testes das RPC 0024/0025 e do fecho da escrita directa (papéis + claims, incluindo sessão recente). Recusa correr fora da simulação; termina em ROLLBACK; falha com excepção se houver FAIL. | **Só local** |
| `local/lote2-concurrency.local.sh` | Concorrência de `set_activity_interest` com processos psql paralelos (lock `FOR UPDATE`, +2/+20/+1 exactos). | **Só local** |
| `local/lote2-http-e2e.local.mjs` + `local/lote2-http-e2e.fixtures.local.sql` | 35 pedidos ao PostgREST local (127.0.0.1) com JWT HS256 locais: RPC, negações de `anon`, erros do contrato. | **Só local** |
| `http-readonly-checks.staging.mjs` | 13 pedidos **só GET/HEAD** à Data API do staging (positivos e negações). Host fixo do staging; chave publishable lida de variável, nunca impressa. | **Só staging** (ou auto-teste local) |
| `local/analyze-audit.mjs`, `local/drift-audits.mjs`, `local/compare-audits.mjs` | Análise local dos CSV da auditoria: sanitização + P1/P2; deriva (mesmo estado); antes/depois da 0023 (8/8). Não ligam a nada. | Local |

## 1. Auditoria só de leitura (`grants-audit.readonly.sql`)

Ordem recomendada: staging primeiro, produção depois, em sessões
separadas, cada uma com a sua evidência.

1. Abrir o Dashboard e confirmar o ref no URL:
   staging `jvtcgomwbfojsttepcfc`, produção `ccpqngyupukdefaqvzgl`. Print.
2. SQL Editor → *New query* → colar o ficheiro inteiro, sem alterações.
3. Antes de correr, confirmar que, tirando comentários, o texto começa por
   `with` e que a única instrução é o `select` final (nenhum `insert`,
   `update`, `delete`, `grant`, `revoke`, `alter`, `create`, `drop`).
4. *Run*. Exportar o resultado em CSV:
   `grants-audit-<staging|producao>-<AAAAMMDD>.csv`.
5. Sanitização antes de partilhar: a saída só tem metadados do catálogo
   (tabelas, papéis, privilégios, grantor, políticas, funções, versão).
   Confirmar que nenhuma linha tem e-mails, UUID de utilizadores, tokens
   ou chaves.
6. Não correr nada mais nessa sessão.

Alternativa por `psql` (só se já houver acesso configurado, nunca colar
a connection string em chats), forçando só leitura:
`PGOPTIONS="-c default_transaction_read_only=on" psql "<ligação>" -v ON_ERROR_STOP=1 -f grants-audit.readonly.sql --csv -o <saida>.csv`

### Como ler

| Secção | Responde a |
|---|---|
| V versao | Versão do PostgreSQL do ambiente |
| A rls | A tabela existe? RLS ligado? FORCE? Quantas políticas? `security_invoker` nas vistas |
| B privs | Privilégios efectivos `anon` / `authenticated` / `service_role` × 7 (`T` tabela, `C` só colunas, `-` nenhum) |
| C colunas | Privilégios só de coluna |
| L acl | Entradas de ACL com **grantor** (tabela e coluna), incl. `PUBLIC`: base para o rollback |
| D policies | Políticas RLS completas |
| E schema | `USAGE` em `public`, `staging`, `auth` |
| F funcoes | `EXECUTE` e `SECURITY DEFINER` (incl. `auth.uid/jwt/role`) |
| G sequencias | Sequências em `public` (o desenho não precisa de nenhuma) |
| H triggers | Triggers nas tabelas auditadas |
| I desenho | Real vs. desenho (v2): `FALTA` (0000/0023 em falta), `EXTRA` (há, app não usa) |
| I proibido | v2: privilégios que não podem existir depois da 0024 (UPDATE de `anon` em `activities`, escrita em `active_activities`, qualquer privilégio em `activity_interests`): `ATENCAO` se existirem |
| J default acl | Default privileges, que explicam diferenças entre ambientes |
| K cadeia | Marcadores das migrações 0012–0025 aplicadas |

Fora do staging, `EXTRA` é informativo: **não** é ordem para retirar
nada, nem prova de que os ambientes devem ser iguais.

Nota sobre o grantor: no Supabase, um GRANT feito pelo Dashboard
(superutilizador) fica registado com o **dono** da tabela como grantor,
igual ao de uma migração. Por isso a 0023 exige estado limpo (P2) em vez
de confiar só no grantor.

## 2. Testes de acesso (`mobile-access-tests.staging.sql`)

Só depois da auditoria do staging e, para o resultado final, depois da
0023. Antes da 0023, as 16 linhas que dependem dela falham com
`deny_grant` (diagnóstico D1).

1. Confirmar o ref do staging no URL (print).
2. Ter duas contas de teste de staging, A e B, sem `app_metadata.role`.
   Copiar os UUID do *Authentication → Users*.
3. No ficheiro, preencher `v_confirm := 'staging'`, `v_ref` com o ref que
   o URL mostra, e os dois UUID.
4. Correr o ficheiro inteiro. O resultado aparece como **erro**: é de
   propósito, a excepção final garante o rollback.
5. Guardar o texto do erro como `access-tests-staging-<AAAAMMDD>.txt`.
6. Critério: `0 FAIL de 61` (com 0023–0025 aplicadas). Qualquer `FAIL` bloqueia a build.

Guardas: recusa sem `v_ref` do staging, recusa se `auth.users` tiver 20
ou mais contas, e `lock_timeout` 2 s / `statement_timeout` 30 s. Qualquer
erro, previsto ou não, desfaz tudo (provado localmente com um lock).

As linhas `[0024]`/`[0025]` testam o desenho do Lote 2: escrita directa em
`activities`/`active_activities`/`activity_interests` negada por GRANT,
RPC de interesses como `authenticated` (+1 uma vez, -1, só as próprias
linhas) e `delete_my_account` recusada com `28000` sem sessão recente (o
teste nunca apaga a conta). Antes da 0024/0025 estas linhas falham.

## 3. Prova ponta-a-ponta pela Data API

### 3a. Só leitura, sem contas (`http-readonly-checks.staging.mjs`)

Confirma, através do gateway e do PostgREST do Supabase, que a 0023
funciona para `anon` e que as negações continuam. Só GET/HEAD: não há
nenhum método de escrita no ficheiro. Só envia o cabeçalho `apikey`.
Nunca imprime a chave nem corpos de resposta (só status, código de erro e
número de linhas). Recusa `sb_secret_`, JWT que não seja `role=anon` do
staging, e qualquer host que não seja o do staging.

| # | Pedido | Esperado |
|---|---|---|
| R1–R3 | `GET categories / venues / partners?select=id&limit=1` | 200 |
| R4 | `GET active_activities?select=id,venues(name)&limit=1` (embed) | 200 |
| R5 | `GET activities?select=id&limit=1` | 200 |
| R6 | `HEAD categories` com `Prefer: count=exact` | 200/206 |
| N1–N5 | `GET favorites / activity_interests(user_id,device_id) / suggestions / users / products` | 401 (42501) |
| N6 | `GET ingestion_runs` com `Accept-Profile: staging` | 406 ou 401 |
| N7 | `GET categories` **sem** `apikey` | 401 (gateway) |

Execução (PowerShell; a chave é pedida sem eco e apagada no fim):

```powershell
$sec = Read-Host "Chave PUBLISHABLE do STAGING (nao e mostrada)" -AsSecureString
$env:VIVERE_STAGING_PUBLISHABLE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
node db/audit/http-readonly-checks.staging.mjs
Remove-Item Env:VIVERE_STAGING_PUBLISHABLE_KEY; $sec = $null
```

Critério: `TOTAL 13/13`. Validado localmente (PostgREST 14.18, base fiel
ao staging): 12/12 com a 0023 (N7 só existe no gateway) e 7/12 sem a 0023
(contraprova: R1–R4 e R6 falham).

Staging (SEC-O-021, 2026-11-07): `TOTAL 13/13` (R1–R6 e N1–N7). Os
positivos devolveram 0 linhas porque as tabelas estavam vazias no
staging (estatísticas do catálogo: `n_live_tup = 0`), não por filtragem
do RLS. Fica provado o acesso (códigos HTTP e privilégios), não a
apresentação de dados reais no app.

### 3b. Com contas de teste e escrita (NÃO autorizado)

Validada localmente com PostgREST 14.18 e 16.5 (18/18 em ambos). Em
staging, com a chave publishable de staging e tokens das contas de teste,
a partir de um script local que nunca imprime chaves nem tokens:

| # | Papel | Pedido | Esperado |
|---|---|---|---|
| H1 | anon | `GET /rest/v1/categories?select=*` | 200 |
| H2 | anon | `GET /rest/v1/active_activities?select=*,venues(name,address,lat,lng,phone)&limit=1` | 200 |
| H3 | anon | `GET /rest/v1/partners?select=*` | 200 |
| H4 | anon | `POST /rest/v1/activity_interests?on_conflict=activity_id,device_id` (merge-duplicates) | 401 (42501) — 0024 bloqueada |
| H5 | anon | `POST /rest/v1/suggestions` com `Prefer: return=minimal` | 201 |
| H5b | anon | `POST /rest/v1/suggestions` com `status` | 401 (42501) |
| H5c | anon | `POST /rest/v1/suggestions` com `return=representation` | 401 (42501) |
| H6 | anon | `GET /rest/v1/favorites` | 401 (42501) |
| H7 | anon | `GET /rest/v1/users` | 401 (42501) |
| H8 | conta A | `GET /rest/v1/favorites?select=*,activities(*,venues(name))&user_id=eq.<A>` | 200 |
| H9 | conta A | `HEAD /rest/v1/favorites?user_id=eq.<A>` com `Prefer: count=exact` | 200 |
| H10 | conta A | `POST` e `DELETE` de favorito próprio; `POST` com `user_id` de B | 201 / 204 / 403 |
| H11 | conta A | `GET /rest/v1/favorites?user_id=eq.<B>` | 200 com `[]` |
| H12 | conta A | upsert de interesse | 403 (42501) — 0024 bloqueada |
| H13 | anon | `GET /rest/v1/activity_interests?select=user_id,device_id` | 401 (42501) |
| H14 | anon | `PATCH /rest/v1/venues?id=eq.<id>` | 401 (42501) |

As linhas criadas (H5, H10) são de teste; apagar no fim filtrando pelo
marcador `SEC-O-016B`. Esta fase cria dados e usa credenciais de staging:
precisa de REF próprio.

## 4. Simulação local e lacunas de fidelidade

A simulação (`local/supabase-sim.sql`) é uma **simulação, não uma
reprodução** do Supabase. Usada no SEC-O-016B com PostgreSQL 17.11 (EDB,
binários portáteis) e PostgREST 14.18 / 16.5, só em `127.0.0.1`.

Lacunas conhecidas:
1. **Versão:** a versão do PostgreSQL do staging e da produção é
   desconhecida (a secção `V` da auditoria passa a mostrá-la). O
   comportamento validado (privilégios de coluna, ON CONFLICT, RLS,
   aclexplode, deparse das políticas) é estável desde o PG15, mas a
   comparação exacta de expressões da P1 pode abortar se o formato
   diferir: falha segura, a rever com a saída da auditoria.
2. **Papéis:** `postgres` simulado como no Supabase (não superutilizador,
   BYPASSRLS, membro de anon/authenticated/service_role). Atributos e
   memberships reais podem diferir; a secção `J`/`L` da auditoria mostra.
3. **Default ACL:** simulado a partir da evidência documentada (0000 Fase
   16E, 0019): só TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Não verificado
   remotamente.
4. **Schema `auth`:** mínimo (`auth.users` com poucas colunas; `uid`,
   `jwt`, `role` com a lógica pública do Supabase). Sem GoTrue, sem
   triggers do Auth, sem `supabase_auth_admin`. Lote 2: `auth.sessions`,
   `auth.identities` e `auth.refresh_tokens` mínimos com FK em cascata; o
   `postgres` simulado tem SELECT/DELETE em `auth.users` e SELECT em
   `auth.sessions` (pressuposto da 0025, a confirmar no staging).
5. **Sem Kong/API gateway:** a chave `apikey` não é validada localmente; o
   papel vem só do JWT (anon sem token). No Supabase, a chave publishable
   é trocada pelo gateway.
6. **PostgREST:** a versão do Supabase é desconhecida; testadas 14.18 e
   16.5, que geram o mesmo SQL para o upsert.
7. **Extensões e schemas do Supabase** (`extensions`, `graphql`, `vault`,
   `pgsodium`, `realtime`, `storage`) não existem localmente.
