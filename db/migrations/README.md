# db/migrations — Manifesto

## Ordem de execução

```
0000 → 0001 → 0002 → ... → 0018 → 0019 → 0020 → 0021 → 0022 → 0023 → 0024 → 0025 → 0026 → 0027
   (0024–0027: propostas, só simulação local; staging/produção com REF próprio)
   (0026 é TRANSITÓRIA: na produção vai na mesma janela que 0023→0024→0025;
    a 0027 só depois dos critérios de adopção — docs/runbooks/production-rollout.md)
```

Numérica, estrita. Nenhum *runner* automatizado de migrações foi
encontrado neste repositório (Activity 16/26, Fase 16C.4) — a aplicação
é manual, instrução a instrução, tipicamente via SQL Editor do Supabase.
Cada `<N>.sql` tem um `<N>.rollback.sql` irmão, mas a execução de
*rollback* também é manual — não existe mecanismo automático de
histórico/transacção entre migrações.

## `0000_app_baseline.sql` — BOOTSTRAP ONLY, NEVER APPLY TO EXISTING PRODUCTION

**Esta migração nunca deve ser aplicada ao projecto Supabase de
produção real.** O projecto de produção já contém todos os objectos
que `0000` cria — foram criados manualmente, antes do Engine existir
(confirmado no próprio cabeçalho de `0001_phase3_domain_model.sql`).

`0000` existe **só** para permitir o *bootstrap* de um ambiente novo e
vazio (ex: staging) — reconstrói, a partir de evidência directa do
catálogo ao vivo de produção (nunca de memória nem de inferência),
exactamente a forma original do schema legado da app Vivere 60+, tal
como existia antes de qualquer migração do Engine.

**Antes de aplicar qualquer migração a qualquer ambiente**: o operador
deve registar o estado actual de migração desse ambiente (que
migrações já foram aplicadas) — não existe tabela de *tracking*
automática a consultar.

## `0001`–`0018` — migrações existentes do Engine

Inalteradas por esta Actividade. Continuam a assumir que o schema
legado (`0000`) já existe — correctas em produção (onde sempre existiu
manualmente) e em qualquer ambiente novo que tenha aplicado `0000`
primeiro.

## `0019_engine_runtime_privileges.sql`

Concede a `service_role` (Engine e `review-api`, via PostgREST) os
privilégios mínimos que o código exige, mais `USAGE` nos schemas
`public` e `staging`. É só `GRANT`: aditiva e idempotente, sem
`REVOKE`. Nasceu da Phase D da Activity 16/26: num projecto novo, os
objectos criados por `postgres` herdam um default ACL que dá a
`service_role` apenas `TRUNCATE`, `REFERENCES`, `TRIGGER` e
`MAINTAIN`, e nenhuma migração anterior concede privilégios de tabela
a este role.

Não cobre: expor `staging` na Data API (configuração do projecto, ver
`docs/runbooks/staging-bootstrap.md`), os dados de referência de
`products` e `sources` (pendentes de reconciliação com a produção) nem
os privilégios temporários do security harness (`scripts/staging/`).

**Dívida de hardening registada:** `service_role` tem `BYPASSRLS` e
mantém `TRUNCATE` herdado, inclusive em `staging.raw_*`. A ausência de
`UPDATE` e `DELETE` nessas tabelas não torna o *append-only* absoluto
enquanto `TRUNCATE` permanecer concedido. Fica por decidir à parte
(revogar `TRUNCATE`, `TRIGGER`, `REFERENCES` e `MAINTAIN`), com revisão
Level 2.

O rollback só é um inverso exacto numa cadeia de bootstrap limpa. Não
usar em produção, onde `service_role` já tinha estes privilégios antes
da migração.

## `0020_security_and_views_baseline.sql`

Captura em controlo de versão o estado de segurança real, já aplicado
manualmente em produção ao longo da Activity 15/26 (RLS, políticas,
*trigger*, funções `SECURITY DEFINER`) — nunca encontrado em `0001`-
`0019`. Reproduz exactamente o estado aprovado e confirmado ao vivo
(Activity 16, Fases 16C.2-16C.4), incluindo assimetrias deliberadas
(ex: `venue_resolution_candidates`/`decisions`/`runs` têm RLS sem
nenhuma política, diferente de `activities_staging`/`venues_staging`/
`ingestion_runs`, que têm `service_role_all` explícita) — nunca
uniformizadas nesta migração.

Em produção, aplicar `0020` seria redundante (os objectos já existem)
— por desenho, cada `CREATE POLICY`/`CREATE FUNCTION` falha
ruidosamente se o nome já existir, nunca mascarando silenciosamente
uma divergência real entre o que `0020` assume e o que produção
realmente tem.

## `0021_venues_staging_geographic_status.sql`

Acrescenta `staging.venues_staging.geographic_status` (`text`, NULL
permitido, sem default) e a CHECK `venues_staging_geographic_status_check`
(`NULL` ou `inside_radius`, `buffer_zone`, `outside_region`). A produção já
tem esta coluna e o código depende dela (escrita na ingestão, leitura e
filtro na review-api, filtro de publicação no Engine), mas nenhuma migração
anterior a cria (ADR-0022 regista a proveniência como pendência de
schema-as-code). A 0021 captura em `db/migrations` a definição que a
produção tem, lida da assinatura de schema de 04/10/2026.

Aditiva e sem dados. Usa `IF NOT EXISTS` porque a incerteza é genuína por
desenho (contrato forward-only abaixo): ambientes criados do histórico real
de produção já têm a coluna, os reconstruídos da cadeia não. Em produção
seria um no-op e não deve ser executada lá sem autorização própria.

O rollback apaga a coluna e os seus dados: só para ambientes reconstruídos,
nunca para produção.

## `0022_rls_engine_public_tables.sql`

Liga RLS em `public.products`, `public.sources`, `public.publication_runs` e
`public.publication_events`, sem políticas e sem FORCE. A produção já tem
estas 4 tabelas assim (assinatura de schema de 04/10/2026), e `anon` e
`authenticated` têm lá privilégios de tabela completos: é o RLS sem políticas
que as protege. Nenhuma migração anterior o capturava (a `0020` cobre 7
tabelas de `public` e 6 de `staging`). `service_role` ignora RLS
(`BYPASSRLS`), por isso o Engine não é afectado.

Idempotente por natureza (repetir `ENABLE ROW LEVEL SECURITY` não faz nada),
sem `IF NOT EXISTS`. Em produção seria um no-op e não deve ser executada lá
sem autorização própria. O rollback desliga o RLS e só serve para ambientes
reconstruídos, nunca para produção.

## `0023_mobile_app_table_grants.sql` (APLICADA NO STAGING, SEC-O-020)

**Estado por ambiente:**
- **Staging** (`jvtcgomwbfojsttepcfc`): aplicada em 2026-11-07 pelo SQL Editor
  ("Success. No rows returned"), ficheiro com SHA-256
  `770fb028e4e256990d6128d175864b740ebbf2d5733536dbc5589de168465df6`. A
  auditoria antes/depois (`db/audit/local/compare-audits.mjs`) deu 8/8:
  exactamente 22 entradas de ACL novas, grantor `postgres`, nada removido,
  políticas/RLS/funções/default ACL inalterados. Confirmada em SEC-O-021
  (auditoria sem deriva, HTTP só leitura 13/13).
- **Produção:** NÃO aplicada. Não executar em produção sem auditoria
  específica e autorização Level 2.

O ficheiro não deve ser alterado: o conteúdo tem de continuar igual ao
que foi executado no staging. O SHA-256 acima é do conteúdo com fins de
linha LF (como fica guardado no git). Num checkout Windows com
`core.autocrlf=true` o ficheiro em disco tem CRLF e outro hash; para
comparar: `git show HEAD:db/migrations/0023_mobile_app_table_grants.sql | sha256sum`.

Concede a `anon` e `authenticated` só as operações que o app mobile faz
em 5 tabelas legadas que a `0000` deixou sem GRANT explícito
(`categories`, `venues`, `partners`, `favorites`, `suggestions`), com
privilégios de coluna onde o app escreve um subconjunto conhecido. GRANT
decide que operações se podem tentar; o RLS da `0020` continua a decidir
em que linhas. Não toca em RLS, políticas, `service_role`, `activities`,
`active_activities`, `users` nem `activity_interests`.

Pré-condições, verificadas antes de qualquer GRANT (abortam tudo):
- **P1:** RLS ligado e conjunto de políticas de cada tabela exactamente
  igual ao da `0020` (número, nome, comando, tipo, papéis e expressões).
- **P2:** estado limpo: nenhum dos privilégios a conceder já existe (de
  tabela ou coluna, directo ou via PUBLIC). Se existir, aborta e a decisão
  volta ao Level 2. Consequência: a 0023 **não é idempotente** (reaplicar
  aborta).

O rollback só retira o que a 0023 concedeu: confirma cada entrada de ACL
(com grantor), aborta se houver privilégios extra nessas tabelas e
confirma o estado final. Validado na simulação local (PostgreSQL 17.11 e
PostgREST 14.18/16.5): caminho limpo, rollback, reaplicação, privilégios
preexistentes, políticas adulteradas e privilégio extra antes do rollback.

## `0024_activity_interests_rpc.sql` (PROPOSTA, Lote 2)

Substitui a antiga `0024_activity_interests_grants.sql` (BLOQUEADA no
SEC-O-016B, removida do repositório; a decisão Level 2 foi a opção (c):
RPC). **Estado:** não aplicada em nenhum Supabase; validada só na simulação
local (PostgreSQL 17.11, PostgREST 14.18 e 16.5). Aplicação no staging com
REF próprio, depois da auditoria v2 (`db/audit/grants-audit.readonly.sql`).

O app deixa de escrever em `activity_interests` e em `activities`:
- `set_activity_interest(p_activity_id uuid, p_interested boolean)` →
  `table (interested boolean, interested_count integer)` (PostgREST: array
  com 1 objecto);
- `get_my_interests(p_activity_ids uuid[])` → `setof uuid` (máx. 500 ids).

Ambas `SECURITY DEFINER`, dono `postgres`, `search_path = ''`, nomes
qualificados, EXECUTE só para `authenticated` (revogado de PUBLIC, `anon`,
`authenticated` e `service_role` antes do GRANT; robusto ao default ACL de
funções do Supabase). Sessões anónimas do Supabase Auth (`is_anonymous`)
são tratadas como sem sessão. `set_activity_interest` bloqueia a linha da
actividade (`FOR UPDATE`); marcar exige que esteja em `active_activities`,
desmarcar funciona também com a actividade inactiva; faz `INSERT ... ON
CONFLICT (activity_id, user_id) DO NOTHING` ou `DELETE` e só ajusta o
contador ±1 quando `ROW_COUNT = 1` (nunca abaixo de 0; repetir o mesmo
estado não muda nada). O trigger `guard_activities_update` continua activo.

Erros (contrato Mobile ⇄ Backend): `42501 not_authenticated` (inclui sessão anónima),
`P0002 activity_not_found`, `22023 too_many_ids`, `22023 invalid_parameter`
(`p_interested` nulo). O PostgREST 14/16 devolve HTTP 500 para `P0002`: a
app decide pelo campo `code`.

Privilégios, na mesma transacção: `drop policy compat_interested_count_update`;
`revoke update` em `activities` só de `anon` (`authenticated` mantém-no
para o painel admin, que edita com JWT admin pela política `admin_role_all`;
um utilizador comum já não passa no RLS: 0 linhas); `active_activities` fica
só com SELECT; `activity_interests` sem nenhum privilégio para
`anon`/`authenticated` (DML verificado ausente; TRUNCATE/REFERENCES/TRIGGER/
MAINTAIN do default ACL revogados); `increment_activity_interest` sem EXECUTE
para `anon`/`authenticated` (a função fica). Pendências registadas, fora do
âmbito: INSERT de `anon`/`authenticated` em `activities` (negado pelo RLS) e
TRUNCATE em `suggestions` (default ACL, 0023). Pré-condições P1 (cadeia, políticas
exactas de `activities`, trigger, funções ausentes) e P2 (ACL exacto da
`0000`/`0020`, com grantor) como na `0023`; verificação final antes do
`commit`. **Não é idempotente** (reaplicar aborta em P1).

**Contador `interested_count`: histórico preservado e NÃO auditado.** O valor
actual (incrementos anónimos e escritas directas anteriores) não é
recalculado e pode não coincidir com as linhas de `activity_interests`. Daqui
em diante só muda ±1 em mudança real feita pela RPC. Apagar uma conta
(`0025`) apaga os interesses em cascata sem decrementar o contador.

Rollback: verifica o estado deixado pela 0024 (aborta se diferente ou se a
`0025` estiver aplicada), apaga as funções e repõe a política (texto igual
ao da `0020`) e os GRANT (iguais aos da `0000`/`0020`). Validado: estado
depois do rollback igual ao anterior (auditoria e instantâneo do catálogo).

## `0025_delete_my_account.sql` (PROPOSTA, Lote 2)

`public.delete_my_account() returns void`, `SECURITY DEFINER`, dono
`postgres`, `search_path = ''`, EXECUTE só `authenticated` (revogado também
de `service_role`). Do JWT só usa `auth.uid()`, `session_id` e
`is_anonymous`. Ordem e erros:
1. sem `auth.uid()` ou sessão anónima → `42501 not_authenticated`;
2. sessão não recente → `28000 reauthentication_required` (verificada ANTES de
   revelar se a conta existe ou é gerida): tem de existir `auth.sessions` com
   `id = session_id`, `user_id = auth.uid()`, `not_after` nulo ou futuro e
   `created_at` nos últimos 5 minutos (o refresh do token não muda
   `created_at`; a app faz um login novo);
3. sem linha em `auth.users` → `P0002 user_not_found` (na prática
   inalcançável depois do passo 2);
4. `auth.users.raw_app_meta_data->>'role'` definido → `42501 account_managed`;
5. só se `auth.users.email_confirmed_at` não for nulo: anonimiza as sugestões
   com `lower(email) = lower(auth.users.email)` (`email`, `phone`, `comment`
   a null; o resto fica). Sugestões sem login, com outro e-mail ou com e-mail
   não confirmado não são ligáveis;
6. `delete from auth.users` → cascata em `favorites`, `activity_interests`
   e tabelas do Auth. O contador não é decrementado (ver 0024).

Pressuposto a confirmar no staging antes de aplicar: o `postgres` pode ler
`auth.users`/`auth.sessions` e apagar de `auth.users`. Pré-condições: 0024
aplicada, função ausente, colunas de `auth.users`/`auth.sessions`/
`suggestions` presentes (incl. `email_confirmed_at`), FK de `favorites`/
`activity_interests` com `ON DELETE CASCADE` e nenhuma FK para `auth.users`
fora do schema `auth` com `ON DELETE` diferente de CASCADE/SET NULL. Rollback: apaga a
função depois de verificar dono/ACL (contas já apagadas não voltam).

Testes locais: `db/audit/local/lote2-rpc-tests.local.sql`,
`lote2-concurrency.local.sh`, `lote2-http-e2e.local.mjs` (+ fixtures).

## `0026_legacy_interest_compat.sql` (PROPOSTA, Lote 3 — TRANSITÓRIA)

Decisão Level 2, estratégia (a): separar a criação das RPC (0024) da
revogação do caminho legado, sem alterar 0000–0025 (congeladas). As versões
da app já instaladas (mobile `main` c390c92 e anteriores, `handleToggleFav`)
fazem `PATCH /activities?id=eq.X {interested_count: cache±1}` como `anon` ou
`authenticated` e ignoram erros; com a 0024 esse PATCH deixa de funcionar
(contador congelado, sem erro visível). As outras escritas do app antigo
(upsert/delete em `activity_interests`) já falhavam antes da 0024 (a P2 da
0024 exige que não haja DML para `anon`/`authenticated`) e nenhuma versão
chamou `increment_activity_interest`: não são repostas.

Repõe só o necessário ao PATCH: a política `compat_interested_count_update`
(texto da 0020) com um `COMMENT` que a marca como transitória, e
`GRANT UPDATE (interested_count)` de **coluna** a `anon` (mais estreito que o
UPDATE de tabela da 0000; `authenticated` já tem UPDATE de tabela). O trigger
`guard_activities_update` (0020) continua a limitar a ±1/0, só
`interested_count`, nunca negativo. As RPC ficam intactas.

Ordem: tem de vir **depois** da 0025 (a P1 da 0025 exige a política compat
ausente). Na produção: 0023 → 0024 → 0025 → 0026 na mesma janela. Pré-condições
P1 (RPC da 0024/0025 com dono/ACL, RLS, trigger guard igual ao da 0020 —
tipo, função e MD5 do corpo normalizado —, políticas de `activities` exactas)
e P2 (ACL de `activities` sem UPDATE de anon/PUBLIC e sem privilégios de
coluna; `authenticated` com UPDATE de tabela; endurecimento da 0024 intacto).
Verificação final antes do `commit`. Não idempotente. Cabeçalho declara
`REVOGAÇÃO DEFINITIVA: 0027_revoke_legacy_interest.sql` (verificado por
`scripts/check-migrations.mjs`).

Risco aceite durante a transição (igual à exposição actual da produção, sem
agravamento): qualquer pessoa com a chave anon faz ±1 por pedido em qualquer
actividade; o contador deriva das linhas de `activity_interests` (marca legada
+1 sem linha; legado + RPC da mesma pessoa = 2; desmarcar na versão nova não
retira o +1 legado; cache desactualizada pode dar -1 ao marcar). Ver
`docs/runbooks/production-rollout.md`.

Rollback (`0026_…rollback.sql`): verifica o estado exacto da 0026 e repõe o da
0025 (efeito igual à 0027).

## `0027_revoke_legacy_interest.sql` (PROPOSTA, Lote 3)

Revogação diferida: `drop policy compat_interested_count_update` e
`revoke update (interested_count) … from anon`. Pré-condições = estado exacto
da 0026 (incluindo o comentário de transição); verificação final = estado
exacto da 0025. Validado por instantâneo do catálogo
(`db/audit/local/lote3-catalog-snapshot.local.sql`): uma base 0000→0027 tem
**o mesmo catálogo de segurança** (ACL de tabela/coluna/função com grantor,
políticas, RLS, triggers, comentários, default ACL) que uma base 0000→0025.
Aplicar só depois dos critérios de adopção e com REF próprio. Rollback
(`0027_…rollback.sql`): reabre o caminho legado (igual à 0026), só com REF.

Nota: como o catálogo depois da 0027 é igual ao da 0025, correr de novo a
0026 depois da 0027 não aborta e equivale ao rollback da 0027. A cadeia é
manual (sem tabela de tracking): registar o que foi aplicado em cada ambiente.

Testes locais: `db/audit/local/run-lote3-compat.sh` (cadeia, instantâneos,
rollbacks, pré-condições adulteradas, cliente antigo × RPC, concorrência e
suites do Lote 2 no estado final) e `lote3-compat-tests.local.sql`.

## Contrato forward-only

Migrações são sempre avançadas, nunca reaplicadas. `IF NOT EXISTS`/
`IF EXISTS` são usados **só** onde a incerteza é genuína por desenho
(ex: `CREATE SCHEMA IF NOT EXISTS staging` em `0001`) — nunca como
atalho para esconder um erro real de ordem ou de execução duplicada.
