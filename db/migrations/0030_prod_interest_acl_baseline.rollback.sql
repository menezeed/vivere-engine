-- ============================================================
-- Rollback 0030 — PRODUÇÃO: repor o ACL de activity_interests e
--                 active_activities observado na E2 (20/11/2026)
--
-- REF: ver 0030_prod_interest_acl_baseline.sql. ESTADO: PROPOSTA, NÃO
-- APLICADA. Validado só na simulação local.
--
-- Quando: a 0024 abortou depois da 0030 (na mesma sessão), ou na ordem
-- de rollback de emergência 0026 → 0025 → 0024 → 0030.
--
-- R1 Corre como postgres; 0024 NÃO aplicada (set_activity_interest,
--    get_my_interests e delete_my_account ausentes): fazer primeiro o
--    rollback da 0024.
-- R2 ACL de tabela EXACTO deixado pela 0030 (= ponto de partida da 0024),
--    grantor = quem corre, sem privilégios de coluna. Qualquer diferença
--    aborta.
-- R3 Repõe: activity_interests anon {SELECT, INSERT}, authenticated
--    {SELECT, INSERT, DELETE}, sem TRUNCATE/REFERENCES/TRIGGER/MAINTAIN;
--    MAINTAIN em active_activities para anon e authenticated.
-- R4 Confirma o ACL observado na E2.
-- ============================================================

begin;

do $pre$
declare
  v_problems text;
  v_me oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);
begin
  if current_user <> 'postgres' then
    raise exception 'rollback 0030 abortado (R1): correr como postgres (current_user=%)', current_user;
  end if;

  select string_agg('funcao existe: public.' || f.proname, '; ') into v_problems
  from pg_catalog.pg_proc f
  join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
  where f.proname in ('set_activity_interest', 'get_my_interests', 'delete_my_account');
  if v_problems is not null then
    raise exception 'rollback 0030 abortado (R1, fazer antes o rollback da 0025/0024): %', v_problems;
  end if;

  with expected(tbl, grantee, priv) as (
    select 'activity_interests', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
    union all
    select 'active_activities', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  ),
  actual as (
    select c.relname::text as tbl,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type::text as priv
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and a.grantor = v_me
  )
  select string_agg(p, '; ' order by p) into v_problems from (
    (select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl as p from expected
     except select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl from actual)
    union all
    (select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from actual
     except select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from expected)
    union all
    select 'grantor diferente: ' || pg_catalog.pg_get_userbyid(a.grantee) || ' ' || a.privilege_type || ' ' || c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and a.grantor <> v_me
    union all
    select 'privilegio de coluna: ' || c.relname || '(' || att.attname || ') ' || a.privilege_type
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  ) x;
  if v_problems is not null then
    raise exception 'rollback 0030 abortado (R2, estado diferente do deixado pela 0030; nada alterado): %', v_problems;
  end if;
end;
$pre$;

revoke truncate, references, trigger, maintain on public.activity_interests from anon, authenticated;
grant select, insert on public.activity_interests to anon;
grant select, insert, delete on public.activity_interests to authenticated;
grant maintain on public.active_activities to anon, authenticated;

do $post$
declare
  v_problems text;
  v_me oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);
begin
  with expected(tbl, grantee, priv) as (
    values ('activity_interests', 'anon', 'INSERT'), ('activity_interests', 'anon', 'SELECT'),
           ('activity_interests', 'authenticated', 'DELETE'), ('activity_interests', 'authenticated', 'INSERT'),
           ('activity_interests', 'authenticated', 'SELECT')
    union all
    select 'active_activities', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
  ),
  actual as (
    select c.relname::text as tbl,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type::text as priv
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and a.grantor = v_me
  )
  select string_agg(p, '; ' order by p) into v_problems from (
    (select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl as p from expected
     except select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl from actual)
    union all
    (select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from actual
     except select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from expected)
  ) x;
  if v_problems is not null then
    raise exception 'rollback 0030 incompleto (verificacao final), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
