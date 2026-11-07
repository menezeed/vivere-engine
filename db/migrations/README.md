# db/migrations — Manifesto

## Ordem de execução

```
0000 → 0001 → 0002 → ... → 0018 → 0019 → 0020 → 0021 → 0022 → 0023   (0024: BLOQUEADA, fora da cadeia aplicável)
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

## `0024_activity_interests_grants.sql` (BLOQUEADA, SEC-O-016B)

Não concede nada: executar o ficheiro só levanta uma excepção. A
simulação local provou que o upsert do app (PostgREST `on_conflict` +
`merge-duplicates`) exige INSERT, UPDATE e SELECT nas 3 colunas, incluindo
`user_id`. Com as políticas actuais, isso não cumpre o critério de mínimo
privilégio definido pelo Level 2 (SEC-O-016B). Até decisão Level 2, os interesses não persistem em
staging e esse fluxo fica por validar. Opções no cabeçalho do ficheiro.

## Contrato forward-only

Migrações são sempre avançadas, nunca reaplicadas. `IF NOT EXISTS`/
`IF EXISTS` são usados **só** onde a incerteza é genuína por desenho
(ex: `CREATE SCHEMA IF NOT EXISTS staging` em `0001`) — nunca como
atalho para esconder um erro real de ordem ou de execução duplicada.
