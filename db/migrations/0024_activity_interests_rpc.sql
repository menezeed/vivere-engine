-- ============================================================
-- Migration 0024 — Interesses por RPC (set_activity_interest,
--                  get_my_interests) e fecho da escrita directa em
--                  activities / active_activities
--
-- REF: Lote 2 (contrato v1.1, C1). Substitui a 0024 BLOQUEADA
-- (0024_activity_interests_grants.sql, SEC-O-016B, opção c).
-- ESTADO: PROPOSTA, NÃO APLICADA em nenhum Supabase. Validada só na
-- simulação local (db/audit/local). Aplicar só com REF próprio, depois
-- da auditoria db/audit/grants-audit.readonly.sql no ambiente alvo.
--
-- DESENHO
-- O app deixa de escrever em activity_interests e em activities. Usa só:
--   public.set_activity_interest(p_activity_id uuid, p_interested boolean)
--     returns table (interested boolean, interested_count integer)
--   public.get_my_interests(p_activity_ids uuid[]) returns setof uuid
-- Ambas SECURITY DEFINER, dono postgres, `set search_path = ''`, nomes
-- qualificados, EXECUTE só para authenticated (revogado de PUBLIC, anon,
-- authenticated e service_role antes do GRANT: o default ACL de funções
-- do Supabase pode dar EXECUTE a PUBLIC ou aos papéis da API). Sem sessão
-- não há interesse no servidor (decisão Level 2, opção C: interesse
-- anónimo fica só no dispositivo). Sessões anónimas do Supabase Auth
-- (claim is_anonymous = true, papel authenticated) são recusadas como
-- sem sessão.
--
-- set_activity_interest (atómica e idempotente):
--   1. auth.uid() nulo ou JWT com is_anonymous = true -> 42501
--      not_authenticated; p_interested nulo -> 22023 invalid_parameter;
--   2. SELECT ... FOR UPDATE da linha de public.activities: serializa
--      chamadas concorrentes sobre a mesma actividade;
--   3. a actividade tem de existir (senão P0002 activity_not_found); para
--      MARCAR tem também de estar em public.active_activities (senão
--      P0002). DESMARCAR funciona com a actividade inactiva (o utilizador
--      pode sempre retirar o próprio interesse; o contador desce 1);
--   4. true  -> INSERT ... ON CONFLICT (activity_id, user_id) DO NOTHING
--      false -> DELETE da linha do próprio utilizador;
--   5. o contador só muda se ROW_COUNT = 1 (+1 / -1), nunca abaixo de 0.
--      Repetir o mesmo estado não muda nada. O trigger
--      guard_activities_update (0020) continua activo e aceita a
--      alteração (só interested_count, delta ±1).
-- get_my_interests: só linhas de auth.uid(); null ou vazio -> conjunto
--   vazio; mais de 500 ids -> 22023 too_many_ids.
--
-- CONTADOR: o histórico de public.activities.interested_count é
-- PRESERVADO tal como está (inclui incrementos anónimos e alterações
-- directas feitas antes desta migração, via política compat e
-- increment_activity_interest) e NÃO É AUDITADO nem recalculado: pode
-- não coincidir com o número de linhas de activity_interests. Daqui em
-- diante só muda ±1 em mudança real feita por esta RPC (ou por
-- service_role/admin). Apagar uma conta (0025) apaga as linhas de
-- interesse em cascata mas NÃO decrementa o contador.
--
-- PRIVILÉGIOS (mesma transacção)
--   * drop policy compat_interested_count_update on public.activities;
--   * revoke UPDATE em public.activities só de anon (a 0000 concedeu-o
--     ao nível da tabela; um REVOKE de tabela retira também qualquer
--     privilégio de coluna do mesmo tipo). authenticated MANTÉM o UPDATE:
--     o painel admin antigo edita com JWT admin pela política
--     admin_role_all; sem a política compat, um authenticated comum não
--     passa no RLS (0 linhas) e o trigger guard continua activo.
--     INSERT/SELECT/REFERENCES da 0000 ficam (INSERT continua negado pelo
--     RLS; pendência registada);
--   * public.active_activities: anon/authenticated ficam só com SELECT
--     (retira INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER da
--     0000; resolve S2);
--   * public.activity_interests: NENHUM privilégio para anon/authenticated.
--     SELECT/INSERT/UPDATE/DELETE não existem (verificado em P2); os
--     TRUNCATE/REFERENCES/TRIGGER/MAINTAIN do default ACL do Supabase são
--     revogados aqui (o rollback repõe-nos);
--   * revoke EXECUTE de public.increment_activity_interest de anon e
--     authenticated (a função fica, sem uso pelo app).
--
-- PRÉ-CONDIÇÕES (abortam tudo antes de qualquer alteração)
--  P1 Estado da cadeia: 0023 aplicada (anon com SELECT em
--     public.categories); RLS ligado em activities e activity_interests;
--     conjunto de políticas de public.activities EXACTAMENTE o da 0020
--     (incluindo compat_interested_count_update); trigger
--     guard_activities_update presente e activo; increment_activity_
--     interest(uuid, smallint) presente; set_activity_interest e
--     get_my_interests ausentes (qualquer assinatura); delete_my_account
--     ausente.
--  P2 ACL exacto da 0000/0020 (base do rollback): anon e authenticated
--     com UPDATE de tabela em activities (grantor = quem corre) e sem
--     UPDATE de coluna; em active_activities exactamente os 7
--     privilégios de tabela da 0000 (grantor = quem corre) e nenhum de
--     coluna; em activity_interests exactamente TRUNCATE, REFERENCES,
--     TRIGGER e MAINTAIN de tabela (default ACL, grantor = quem corre),
--     nenhum outro e nenhum de coluna;
--     EXECUTE de increment_activity_interest explícito para anon e
--     authenticated (grantor = quem corre) e não para PUBLIC. Assim o
--     rollback repõe exactamente o estado anterior.
--
-- Correr como `postgres` (o papel que aplicou 0000/0020). NÃO é
-- idempotente: reaplicar aborta em P1.
-- ROLLBACK: 0024_activity_interests_rpc.rollback.sql.
-- ============================================================

begin;

do $pre$
declare
  v_problems text;
  v_me oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);
begin
  -- P1a: 0023 aplicada, RLS, trigger e funções
  select string_agg(p, '; ') into v_problems from (
    select '0023 nao aplicada (anon sem SELECT em public.categories)' as p
    where not coalesce(pg_catalog.has_table_privilege('anon', pg_catalog.to_regclass('public.categories'), 'SELECT'), false)
    union all
    select 'rls desligado ou tabela em falta: ' || t
    from unnest(array['activities', 'activity_interests']) t
    where not exists (select 1 from pg_catalog.pg_class c
                      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t
                        and c.relkind = 'r' and c.relrowsecurity)
    union all
    select 'trigger guard_activities_update ausente ou desactivado'
    where not exists (select 1 from pg_catalog.pg_trigger tg
                      where tg.tgrelid = pg_catalog.to_regclass('public.activities')
                        and tg.tgname = 'guard_activities_update' and tg.tgenabled = 'O')
    union all
    select 'funcao public.increment_activity_interest(uuid, smallint) ausente'
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is null
    union all
    select 'funcao ja existe: public.' || f.proname || '(' || pg_catalog.pg_get_function_identity_arguments(f.oid) || ')'
    from pg_catalog.pg_proc f
    join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
    where f.proname in ('set_activity_interest', 'get_my_interests', 'delete_my_account')
  ) x;
  if v_problems is not null then
    raise exception '0024 abortada (P1): %', v_problems;
  end if;

  -- P1b: políticas de public.activities exactamente as da 0020
  with expected(pol, cmd, perm, roles, qual, chk) as (values
    ('Leitura pública de atividades', 'SELECT', 'PERMISSIVE', 'public', 'true', '-'),
    ('admin_role_all', 'ALL', 'PERMISSIVE', 'authenticated',
      '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)',
      '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)'),
    ('compat_interested_count_update', 'UPDATE', 'PERMISSIVE', 'anon,authenticated', 'true', 'true')
  ),
  actual as (
    select p.policyname::text, p.cmd, p.permissive,
           pg_catalog.array_to_string(array(select r::text from unnest(p.roles) r order by 1), ','),
           coalesce(p.qual, '-'), coalesce(p.with_check, '-')
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'activities'
  ),
  diff as (
    (select 'esperada e ausente/diferente: ' as k, * from expected
     except select 'esperada e ausente/diferente: ', * from actual)
    union all
    (select 'inesperada: ', * from actual
     except select 'inesperada: ', * from expected)
  )
  select string_agg(k || 'activities.' || pol || ' [' || cmd || ']', '; ')
    into v_problems from diff;
  if v_problems is not null then
    raise exception '0024 abortada (P1, politicas): %', v_problems;
  end if;

  -- P2: ACL exacto (tabela e coluna) para anon/authenticated/PUBLIC
  with expected(tbl, grantee, priv) as (
    select 'activities', g, 'UPDATE' from unnest(array['anon', 'authenticated']) g
    union all
    select 'active_activities', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    union all
    select 'activity_interests', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
  ),
  tacl as (
    select c.relname::text as tbl,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type as priv, a.grantor
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relname in ('activities', 'active_activities', 'activity_interests')
  ),
  cacl as (
    select c.relname::text as tbl, att.attname::text as col,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type as priv
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.relname in ('activities', 'active_activities', 'activity_interests')
  ),
  facl as (
    select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type as priv, a.grantor
    from pg_catalog.pg_proc f
    cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
    where f.oid = pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)')
  ),
  problems as (
    select 'em falta (ou outro grantor): ' || e.grantee || ' ' || e.priv || ' ' || e.tbl as p
    from expected e
    where not exists (select 1 from tacl t where t.tbl = e.tbl and t.grantee = e.grantee
                        and t.priv = e.priv and t.grantor = v_me)
    union all
    select 'privilegio inesperado: ' || t.grantee || ' ' || t.priv || ' ' || t.tbl
           || ' grantor=' || pg_catalog.pg_get_userbyid(t.grantor)
    from tacl t
    where t.grantee in ('anon', 'authenticated', 'PUBLIC')
      and (t.tbl in ('active_activities', 'activity_interests') or t.priv = 'UPDATE')
      and not exists (select 1 from expected e where e.tbl = t.tbl and e.grantee = t.grantee
                        and e.priv = t.priv and t.grantor = v_me)
    union all
    select 'privilegio de coluna: ' || c.grantee || ' ' || c.priv || ' ' || c.tbl || '(' || c.col || ')'
    from cacl c
    where c.grantee in ('anon', 'authenticated', 'PUBLIC')
      and (c.tbl in ('active_activities', 'activity_interests') or c.priv = 'UPDATE')
    union all
    select 'activity_interests: ' || r || ' ja tem ' || pr
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
    where pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.activity_interests'), pr)
       or (pr <> 'DELETE'
           and pg_catalog.has_any_column_privilege(r, pg_catalog.to_regclass('public.activity_interests'), pr))
    union all
    select 'increment_activity_interest: EXECUTE em falta (ou outro grantor) para ' || g
    from unnest(array['anon', 'authenticated']) g
    where not exists (select 1 from facl f where f.grantee = g and f.priv = 'EXECUTE' and f.grantor = v_me)
    union all
    select 'increment_activity_interest: EXECUTE para PUBLIC'
    where exists (select 1 from facl f where f.grantee = 'PUBLIC')
  )
  select string_agg(p, '; ') into v_problems from problems;
  if v_problems is not null then
    raise exception '0024 abortada (P2, ACL diferente do esperado; decisao Level 2): %', v_problems;
  end if;
end;
$pre$;

-- ------------------------------------------------------------
-- RPC: marcar / desmarcar interesse
-- ------------------------------------------------------------
create function public.set_activity_interest(p_activity_id uuid, p_interested boolean)
returns table (interested boolean, interested_count integer)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict error
declare
  v_uid     uuid := auth.uid();
  v_count   integer;
  v_changed bigint := 0;
begin
  -- sem sessão, ou sessão anónima do Supabase Auth (is_anonymous)
  if v_uid is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_interested is null then
    raise exception using errcode = '22023', message = 'invalid_parameter';
  end if;

  -- Bloqueia a linha da actividade: chamadas concorrentes sobre a mesma
  -- actividade ficam em série; o contador nunca perde actualizações.
  select coalesce(a.interested_count, 0)
    into v_count
  from public.activities a
  where a.id = p_activity_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'activity_not_found';
  end if;
  -- Marcar exige actividade activa; desmarcar não (retirar o próprio
  -- interesse de uma actividade terminada é sempre permitido).
  if p_interested
     and not exists (select 1 from public.active_activities v where v.id = p_activity_id) then
    raise exception using errcode = 'P0002', message = 'activity_not_found';
  end if;

  if p_interested then
    insert into public.activity_interests (activity_id, user_id)
    values (p_activity_id, v_uid)
    on conflict (activity_id, user_id) do nothing;
    get diagnostics v_changed = row_count;
    if v_changed = 1 then
      update public.activities a
         set interested_count = coalesce(a.interested_count, 0) + 1
       where a.id = p_activity_id
      returning a.interested_count into v_count;
    end if;
  else
    delete from public.activity_interests i
     where i.activity_id = p_activity_id
       and i.user_id = v_uid;
    get diagnostics v_changed = row_count;
    if v_changed = 1 and v_count > 0 then
      update public.activities a
         set interested_count = coalesce(a.interested_count, 0) - 1
       where a.id = p_activity_id
      returning a.interested_count into v_count;
    end if;
  end if;

  interested := p_interested;
  interested_count := v_count;
  return next;
end;
$fn$;

-- ------------------------------------------------------------
-- RPC: quais destas actividades têm o meu interesse
-- ------------------------------------------------------------
create function public.get_my_interests(p_activity_ids uuid[])
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
#variable_conflict error
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_activity_ids is null or pg_catalog.cardinality(p_activity_ids) = 0 then
    return;
  end if;
  if pg_catalog.cardinality(p_activity_ids) > 500 then
    raise exception using errcode = '22023', message = 'too_many_ids';
  end if;

  return query
    select distinct i.activity_id
    from public.activity_interests i
    where i.user_id = v_uid
      and i.activity_id = any (p_activity_ids);
end;
$fn$;

alter function public.set_activity_interest(uuid, boolean) owner to postgres;
alter function public.get_my_interests(uuid[]) owner to postgres;

revoke all on function public.set_activity_interest(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.get_my_interests(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.set_activity_interest(uuid, boolean) to authenticated;
grant execute on function public.get_my_interests(uuid[]) to authenticated;

comment on function public.set_activity_interest(uuid, boolean) is
  'Lote 2 (0024): marca/desmarca o interesse de auth.uid(); idempotente; ajusta interested_count ±1 só em mudança real. Contador histórico preservado e não auditado.';
comment on function public.get_my_interests(uuid[]) is
  'Lote 2 (0024): ids (máx. 500) com interesse de auth.uid().';

-- ------------------------------------------------------------
-- Fecho da escrita directa
-- ------------------------------------------------------------
drop policy "compat_interested_count_update" on public.activities;

-- só anon: authenticated mantém UPDATE para o admin (política admin_role_all)
revoke update on public.activities from anon;

revoke truncate, references, trigger, maintain
  on public.activity_interests from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.active_activities from anon, authenticated;

revoke execute on function public.increment_activity_interest(uuid, smallint)
  from anon, authenticated;

-- ------------------------------------------------------------
-- Verificação final (aborta e desfaz tudo se algo não bater)
-- ------------------------------------------------------------
do $post$
declare
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    select 'politica compat ainda existe' as p
    where exists (select 1 from pg_catalog.pg_policies
                  where schemaname = 'public' and tablename = 'activities'
                    and policyname = 'compat_interested_count_update')
    union all
    select r || ' ainda tem ' || pr || ' em ' || t
    from unnest(array['anon', 'authenticated']) r
    cross join (values ('active_activities', 'INSERT'), ('active_activities', 'UPDATE'),
                       ('active_activities', 'DELETE'), ('active_activities', 'TRUNCATE'),
                       ('active_activities', 'REFERENCES'), ('active_activities', 'TRIGGER'),
                       ('active_activities', 'MAINTAIN'),
                       ('activity_interests', 'SELECT'), ('activity_interests', 'INSERT'),
                       ('activity_interests', 'UPDATE'), ('activity_interests', 'DELETE'),
                       ('activity_interests', 'TRUNCATE'), ('activity_interests', 'REFERENCES'),
                       ('activity_interests', 'TRIGGER'), ('activity_interests', 'MAINTAIN')) v(t, pr)
    where pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.' || t), pr)
       or (pr in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
           and pg_catalog.has_any_column_privilege(r, pg_catalog.to_regclass('public.' || t), pr))
    union all
    select 'anon ainda tem UPDATE em activities'
    where pg_catalog.has_table_privilege('anon', 'public.activities', 'UPDATE')
       or pg_catalog.has_any_column_privilege('anon', 'public.activities', 'UPDATE')
    union all
    select 'authenticated perdeu UPDATE de tabela em activities (necessario ao admin)'
    where not pg_catalog.has_table_privilege('authenticated', 'public.activities', 'UPDATE')
    union all
    select 'entrada de ACL em activity_interests para ' || pg_catalog.pg_get_userbyid(a.grantee)
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c
                                where c.oid = pg_catalog.to_regclass('public.activity_interests'))) a
    where a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated')
    union all
    select r || ' perdeu SELECT em ' || t
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['activities', 'active_activities']) t
    where not pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.' || t), 'SELECT')
    union all
    select r || ' execute=' || pg_catalog.has_function_privilege(r, f, 'EXECUTE')::text || ' em ' || f
    from (values ('anon', 'public.set_activity_interest(uuid, boolean)', false),
                 ('anon', 'public.get_my_interests(uuid[])', false),
                 ('anon', 'public.increment_activity_interest(uuid, smallint)', false),
                 ('authenticated', 'public.set_activity_interest(uuid, boolean)', true),
                 ('authenticated', 'public.get_my_interests(uuid[])', true),
                 ('authenticated', 'public.increment_activity_interest(uuid, smallint)', false),
                 ('service_role', 'public.set_activity_interest(uuid, boolean)', false),
                 ('service_role', 'public.get_my_interests(uuid[])', false)) v(r, f, want)
    where pg_catalog.has_function_privilege(r, f, 'EXECUTE') <> want
    union all
    select 'PUBLIC com EXECUTE em ' || f.proname
    from pg_catalog.pg_proc f
    cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
    where f.oid in (pg_catalog.to_regprocedure('public.set_activity_interest(uuid, boolean)'),
                    pg_catalog.to_regprocedure('public.get_my_interests(uuid[])'))
      and a.grantee = 0
    union all
    select 'ACL inesperado em ' || f.proname
    from pg_catalog.pg_proc f
    where f.oid in (pg_catalog.to_regprocedure('public.set_activity_interest(uuid, boolean)'),
                    pg_catalog.to_regprocedure('public.get_my_interests(uuid[])'))
      and array(select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
                       || ':' || a.privilege_type
                from pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                order by 1)
          <> array['authenticated:EXECUTE', 'postgres:EXECUTE']
    union all
    select 'funcao sem security definer/search_path vazio/dono postgres: ' || f.proname
    from pg_catalog.pg_proc f
    where f.oid in (pg_catalog.to_regprocedure('public.set_activity_interest(uuid, boolean)'),
                    pg_catalog.to_regprocedure('public.get_my_interests(uuid[])'))
      and not (f.prosecdef and f.proconfig = array['search_path=""']
               and pg_catalog.pg_get_userbyid(f.proowner) = 'postgres')
  ) x;
  if v_problems is not null then
    raise exception '0024 incompleta (verificacao final), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
