-- ============================================================
-- 0020 — Baseline de Segurança: Captura em Controlo de Versão do
-- Estado Real Aprovado (Activity 15/26 + Activity 16/26, Fase 16D)
--
-- Esta migração NÃO introduz nenhum comportamento novo. Reproduz,
-- exactamente, o estado de segurança já aplicado manualmente em
-- produção ao longo da Activity 15 (RLS + políticas + trigger +
-- funções), confirmado por inspecção directa do catálogo ao vivo
-- (Activity 16, Fases 16C.2-16C.4) — nunca encontrado em nenhuma das
-- migrações 0001-0019.
--
-- Em produção (projecto já existente), aplicar esta migração seria
-- redundante mas inofensivo (CREATE POLICY com o mesmo nome falharia
-- se já existir — por desenho, para nunca mascarar silenciosamente
-- uma divergência real entre o que esta migração assume e o que
-- produção realmente tem). Em staging (bootstrap novo, depois de
-- 0000-0019), esta migração é o que efectivamente implementa a
-- correcção de segurança da Activity 15 pela primeira vez nesse
-- ambiente.
--
-- Deliberadamente NÃO uniformizado: venue_resolution_candidates/
-- decisions/runs têm RLS activo com ZERO políticas (diferente de
-- activities_staging/venues_staging/ingestion_runs, que têm
-- service_role_all explícita) — reproduzido exactamente assim, nunca
-- "corrigido" para consistência aqui. Ver 16C.4 para a evidência.
-- ============================================================


-- ============================================================
-- PARTE 1 — RLS + políticas, tabelas public.* (legado, 0000)
-- ============================================================

alter table public.activities enable row level security;
alter table public.venues enable row level security;
alter table public.favorites enable row level security;
alter table public.activity_interests enable row level security;
alter table public.suggestions enable row level security;
alter table public.partners enable row level security;
alter table public.categories enable row level security;

-- ---- activities ----
create policy "Leitura pública de atividades" on public.activities
  for select to public
  using (true);

create policy "admin_role_all" on public.activities
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "compat_interested_count_update" on public.activities
  for update to anon, authenticated
  using (true)
  with check (true);

-- ---- venues ----
create policy "Leitura pública de venues" on public.venues
  for select to public
  using (true);

create policy "admin_role_all" on public.venues
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---- categories ----
create policy "Qualquer um pode ver categorias" on public.categories
  for select to public
  using (true);

create policy "admin_role_all" on public.categories
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---- partners ----
create policy "Leitura pública de parceiros" on public.partners
  for select to public
  using (true);

create policy "admin_role_all" on public.partners
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ---- favorites ----
create policy "Favoritos do usuário" on public.favorites
  for all to public
  using (auth.uid() = user_id);

-- ---- activity_interests ----
create policy "Inserir interesse identificado" on public.activity_interests
  for insert to public
  with check (
    (auth.uid() is not null and user_id = auth.uid() and device_id is null)
    or
    (auth.uid() is null and user_id is null and device_id is not null
     and length(trim(device_id)) > 0)
  );

create policy "Qualquer um pode ver interesses" on public.activity_interests
  for select to public
  using (true);

create policy "Só o próprio pode apagar" on public.activity_interests
  for delete to public
  using (auth.uid() = user_id);

-- ---- suggestions ----
create policy "Publico pode enviar sugestao pendente" on public.suggestions
  for insert to public
  with check (status = 'pending' and length(trim(title)) > 0);


-- ============================================================
-- PARTE 2 — Funções SECURITY DEFINER + trigger (Activity 15)
-- ============================================================

create or replace function public.guard_activities_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_without_count jsonb;
  new_without_count jsonb;
  effective_old_count integer;
  delta integer;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' then
    return new;
  end if;

  old_without_count := to_jsonb(old) - 'interested_count';
  new_without_count := to_jsonb(new) - 'interested_count';

  if old_without_count is distinct from new_without_count then
    raise exception 'Apenas interested_count pode ser alterado por esta sessão';
  end if;

  if new.interested_count is null then
    raise exception 'interested_count não pode ficar NULL';
  end if;

  effective_old_count := coalesce(old.interested_count, 0);
  delta := new.interested_count - effective_old_count;

  if delta not in (-1, 0, 1) then
    raise exception 'interested_count só pode variar em exactamente +1, -1, ou manter-se';
  end if;

  if new.interested_count < 0 then
    raise exception 'interested_count nunca pode ficar negativo';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_activities_update() from public;
revoke all on function public.guard_activities_update() from anon, authenticated;

create trigger guard_activities_update
  before update on public.activities
  for each row
  execute function public.guard_activities_update();


create or replace function public.increment_activity_interest(
  p_activity_id uuid,
  p_delta smallint
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.activities
  set interested_count = greatest(0, coalesce(interested_count, 0) + p_delta)
  where id = p_activity_id
    and p_delta in (1, -1);
$$;

revoke all on function public.increment_activity_interest(uuid, smallint) from public;
grant execute on function public.increment_activity_interest(uuid, smallint)
  to anon, authenticated;


-- ============================================================
-- PARTE 3 — RLS para staging.* não coberta por 0002
-- ============================================================

-- activities_staging / venues_staging / ingestion_runs:
-- RLS + service_role_all, exactamente como confirmado ao vivo.
alter table staging.activities_staging enable row level security;
create policy service_role_all on staging.activities_staging
  for all to service_role
  using (true)
  with check (true);

alter table staging.venues_staging enable row level security;
create policy service_role_all on staging.venues_staging
  for all to service_role
  using (true)
  with check (true);

alter table staging.ingestion_runs enable row level security;
create policy service_role_all on staging.ingestion_runs
  for all to service_role
  using (true)
  with check (true);

-- venue_resolution_candidates / decisions / runs:
-- RLS activo, ZERO políticas — deliberadamente, confirmado ao vivo.
-- service_role continua a aceder normalmente (BYPASSRLS implícito do
-- Supabase para este role, independente de políticas existirem).
-- NUNCA adicionar service_role_all aqui sem decisão explícita
-- separada — isto reproduz o estado real, não o uniformiza.
alter table staging.venue_resolution_candidates enable row level security;
alter table staging.venue_resolution_decisions enable row level security;
alter table staging.venue_resolution_runs enable row level security;

-- raw_activity_items / raw_venue_items: RLS+políticas já pertencem
-- inteiramente a 0002 — nunca duplicadas aqui.
