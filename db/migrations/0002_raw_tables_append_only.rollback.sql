-- ============================================================
-- Rollback de 0002_raw_tables_append_only.sql
--
-- Remove as policies de RLS e desabilita RLS nas tabelas raw_*,
-- restaurando o comportamento anterior (sem trava de UPDATE/DELETE
-- no nível do banco — volta a depender só da convenção de design).
-- ============================================================

drop policy if exists raw_venue_items_allow_insert on staging.raw_venue_items;
drop policy if exists raw_venue_items_allow_select on staging.raw_venue_items;
drop policy if exists raw_venue_items_no_update on staging.raw_venue_items;
drop policy if exists raw_venue_items_no_delete on staging.raw_venue_items;

drop policy if exists raw_activity_items_allow_insert on staging.raw_activity_items;
drop policy if exists raw_activity_items_allow_select on staging.raw_activity_items;
drop policy if exists raw_activity_items_no_update on staging.raw_activity_items;
drop policy if exists raw_activity_items_no_delete on staging.raw_activity_items;

alter table staging.raw_venue_items disable row level security;
alter table staging.raw_activity_items disable row level security;
