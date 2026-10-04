-- ============================================================
-- 0019 — Privilégios de runtime do role service_role
--        (Engine e review-api)
--
-- Activity 16/26, Phase D (achados F1 e F2).
--
-- CONTEXTO:
-- O Engine e a review-api acedem à base de dados por PostgREST com
-- a SUPABASE_SERVICE_KEY (role service_role). service_role tem
-- BYPASSRLS, mas isso só ignora políticas de linha: os privilégios
-- de tabela e o USAGE no schema continuam a ser verificados.
-- Num projecto novo, os objectos criados por `postgres` herdam um
-- default ACL que dá a service_role apenas TRUNCATE, REFERENCES,
-- TRIGGER e MAINTAIN (confirmado em pg_default_acl e relacl no
-- vivere-staging). Nenhuma migração 0000-0018 concede privilégios
-- de tabela a service_role, nem USAGE no schema staging.
--
-- A lista abaixo é o mínimo exigido pelo código no HEAD 6765d10
-- (varredura de .from() e .schema() em src/ e scripts/, Phase D).
-- raw_venue_items e raw_activity_items ficam SEM UPDATE e DELETE.
--
-- DÍVIDA DE HARDENING (registada, fora desta migração):
-- service_role tem BYPASSRLS e mantém TRUNCATE herdado do default
-- ACL, inclusive em staging.raw_*. O RLS de 0002 não vincula
-- service_role, e enquanto TRUNCATE permanecer concedido a ausência
-- de UPDATE e DELETE NÃO torna o append-only absoluto. Esta migração
-- melhora o runtime, não resolve isto. Resolução: decisão separada
-- (REVOKE de TRUNCATE, TRIGGER, REFERENCES e MAINTAIN), com revisão
-- Level 2 e sem alterar privilégios existentes em produção sem
-- autorização própria.
--
-- NATUREZA: só GRANT. Aditiva e idempotente (conceder um privilégio
-- que já existe não faz nada). Nenhum REVOKE: não reduz privilégios
-- que um ambiente já tenha.
--
-- NÃO FAZ (decisões separadas): revogar TRUNCATE, TRIGGER,
-- REFERENCES ou MAINTAIN; privilégios só do security harness (ver
-- scripts/staging/); expor o schema staging na Data API
-- (configuração do projecto, ver docs/runbooks/staging-bootstrap.md);
-- dados de referência de products e sources.
--
-- ROLLBACK: ver 0019_engine_runtime_privileges.rollback.sql
-- (NÃO usar em produção, ver aviso nesse ficheiro).
-- ============================================================

-- USAGE em public incluído por determinismo: idempotente, para
-- não depender do estado por omissão do projecto.
grant usage on schema public  to service_role;
grant usage on schema staging to service_role;

-- staging: tabelas de estado
grant select, insert, update on
  staging.ingestion_runs,
  staging.venues_staging,
  staging.activities_staging,
  staging.venue_resolution_runs
  to service_role;

-- staging: dado bruto e decisões (sem UPDATE nem DELETE)
grant select, insert on
  staging.raw_venue_items,
  staging.raw_activity_items,
  staging.venue_resolution_decisions
  to service_role;

-- staging: candidatos (recriados por actividade: precisa de DELETE)
grant select, insert, update, delete on
  staging.venue_resolution_candidates
  to service_role;

-- public: Publishing Engine
grant select, insert, update on
  public.venues,
  public.activities,
  public.publication_runs
  to service_role;

grant select, insert on public.publication_events to service_role;
