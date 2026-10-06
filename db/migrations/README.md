# db/migrations — Manifesto

## Ordem de execução

```
0000 → 0001 → 0002 → ... → 0018 → 0019 → 0020 → 0021
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

## Contrato forward-only

Migrações são sempre avançadas, nunca reaplicadas. `IF NOT EXISTS`/
`IF EXISTS` são usados **só** onde a incerteza é genuína por desenho
(ex: `CREATE SCHEMA IF NOT EXISTS staging` em `0001`) — nunca como
atalho para esconder um erro real de ordem ou de execução duplicada.
