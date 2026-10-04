-- ============================================================
-- Rollback 0019 — privilégios de runtime de service_role
--
-- AVISO: só é um inverso exacto numa cadeia de bootstrap limpa
-- (ex: staging), onde esta migração criou os privilégios. NÃO
-- EXECUTAR EM PRODUÇÃO: aí o service_role já tinha estes privilégios
-- antes da migração (concedê-los foi um no-op) e revogá-los
-- quebraria o Engine e a review-api.
--
-- Não reverte "grant usage on schema public" (estado por omissão do
-- projecto; removê-lo quebraria o acesso a public.*).
-- Não faz nada aos privilégios do harness (ver scripts/staging/).
-- ============================================================

revoke select, insert, update, delete on staging.venue_resolution_candidates from service_role;

revoke select, insert on public.publication_events from service_role;
revoke select, insert, update on
  public.venues, public.activities, public.publication_runs from service_role;

revoke select, insert on
  staging.raw_venue_items, staging.raw_activity_items, staging.venue_resolution_decisions
  from service_role;

revoke select, insert, update on
  staging.ingestion_runs, staging.venues_staging,
  staging.activities_staging, staging.venue_resolution_runs
  from service_role;

revoke usage on schema staging from service_role;
