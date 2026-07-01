-- ============================================================
-- Rollback de 0001_phase3_domain_model.sql (versão Caminho A)
--
-- Remove as 7 tabelas criadas pela migration adaptada,
-- na ordem inversa de dependência de FK.
-- NÃO toca em nenhuma tabela do schema atual do app
-- (public.venues, public.activities, favorites, etc.).
-- ============================================================

drop table if exists staging.activities_staging cascade;
drop table if exists staging.venues_staging cascade;
drop table if exists staging.raw_activity_items cascade;
drop table if exists staging.raw_venue_items cascade;
drop table if exists staging.ingestion_runs cascade;
drop table if exists public.sources cascade;
drop table if exists public.products cascade;

drop schema if exists staging cascade;
