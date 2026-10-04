-- ============================================================
-- 0020 — Rollback do Baseline de Segurança
--
-- Ordem: trigger antes de função (dependência); políticas antes de
-- RLS disable; funções só depois do trigger removido.
-- ============================================================

-- ---- Parte 3 reversa — staging ----
alter table staging.venue_resolution_runs disable row level security;
alter table staging.venue_resolution_decisions disable row level security;
alter table staging.venue_resolution_candidates disable row level security;

drop policy if exists service_role_all on staging.ingestion_runs;
alter table staging.ingestion_runs disable row level security;

drop policy if exists service_role_all on staging.venues_staging;
alter table staging.venues_staging disable row level security;

drop policy if exists service_role_all on staging.activities_staging;
alter table staging.activities_staging disable row level security;

-- ---- Parte 2 reversa — trigger/funções ----
drop trigger if exists guard_activities_update on public.activities;
drop function if exists public.increment_activity_interest(uuid, smallint);
drop function if exists public.guard_activities_update();

-- ---- Parte 1 reversa — políticas + RLS disable, public.* ----
drop policy if exists "Publico pode enviar sugestao pendente" on public.suggestions;
alter table public.suggestions disable row level security;

drop policy if exists "Só o próprio pode apagar" on public.activity_interests;
drop policy if exists "Qualquer um pode ver interesses" on public.activity_interests;
drop policy if exists "Inserir interesse identificado" on public.activity_interests;
alter table public.activity_interests disable row level security;

drop policy if exists "Favoritos do usuário" on public.favorites;
alter table public.favorites disable row level security;

drop policy if exists "admin_role_all" on public.partners;
drop policy if exists "Leitura pública de parceiros" on public.partners;
alter table public.partners disable row level security;

drop policy if exists "admin_role_all" on public.categories;
drop policy if exists "Qualquer um pode ver categorias" on public.categories;
alter table public.categories disable row level security;

drop policy if exists "admin_role_all" on public.venues;
drop policy if exists "Leitura pública de venues" on public.venues;
alter table public.venues disable row level security;

drop policy if exists "compat_interested_count_update" on public.activities;
drop policy if exists "admin_role_all" on public.activities;
drop policy if exists "Leitura pública de atividades" on public.activities;
alter table public.activities disable row level security;
