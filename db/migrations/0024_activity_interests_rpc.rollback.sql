-- ============================================================
-- Rollback 0024 — retirar as RPC de interesses e repor a escrita
--                 directa exactamente como na 0000/0020
--
-- REF: Lote 2 (contrato v1.1, C1). ESTADO: PROPOSTA, NÃO APLICADA em
-- nenhum Supabase. Validado só na simulação local.
--
-- AVISO: repõe privilégios largos (UPDATE de anon em activities com a
-- política compat using(true), escrita em active_activities, EXECUTE de
-- increment_activity_interest, TRUNCATE/REFERENCES/TRIGGER/MAINTAIN em
-- activity_interests). Só para voltar atrás num ambiente onde a 0024 foi
-- aplicada; NUNCA em produção sem REF próprio.
--
-- Pré-requisito: a 0025 (delete_my_account) NÃO pode estar aplicada
-- (fazer primeiro o rollback da 0025); R1 aborta se estiver.
--
-- PORQUE É SEGURO
--  R1 confirma o estado deixado pela 0024: as duas funções existem com
--     dono postgres e EXECUTE só para o dono e authenticated; a política
--     compat não existe; anon sem UPDATE (tabela ou coluna) em
--     activities e authenticated com UPDATE de tabela (grantor = quem
--     corre); anon/authenticated só com SELECT em active_activities (sem
--     privilégios de coluna); nenhuma entrada de ACL para
--     anon/authenticated/PUBLIC em activity_interests (tabela ou coluna);
--     sem EXECUTE em increment_activity_interest; delete_my_account
--     ausente. Qualquer diferença aborta: não se sabe se o privilégio
--     extra deve ficar.
--  R3 apaga as duas funções e repõe, na mesma forma da 0000/0020 e do
--     default ACL: a política compat (texto idêntico à 0020), GRANT
--     UPDATE de tabela em activities a anon, os 6 privilégios de
--     active_activities, TRUNCATE/REFERENCES/TRIGGER/MAINTAIN de
--     activity_interests a anon/authenticated e EXECUTE de
--     increment_activity_interest para anon e authenticated.
--  R4 confirma o resultado (entradas de ACL com grantor = quem corre,
--     política com a definição da 0020).
-- Qualquer falha aborta a transacção inteira: nada muda.
--
-- DADOS: as linhas de activity_interests e o interested_count criados
-- através da RPC ficam como estão (o rollback não toca em dados).
-- Correr com o mesmo papel que aplicou a 0024 (no Supabase, `postgres`).
-- ============================================================

begin;

do $rb$
declare
  v_me oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    select 'R1 funcao em falta: ' || s as p
    from unnest(array['public.set_activity_interest(uuid, boolean)', 'public.get_my_interests(uuid[])']) s
    where pg_catalog.to_regprocedure(s) is null
    union all
    select 'R1 funcao com ACL/dono inesperado: ' || f.oid::pg_catalog.regprocedure::text
    from pg_catalog.pg_proc f
    where f.oid in (pg_catalog.to_regprocedure('public.set_activity_interest(uuid, boolean)'),
                    pg_catalog.to_regprocedure('public.get_my_interests(uuid[])'))
      and (pg_catalog.pg_get_userbyid(f.proowner) <> 'postgres'
           or array(select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
                           || ':' || a.privilege_type
                    from pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                    order by 1)
              <> array['authenticated:EXECUTE', 'postgres:EXECUTE'])
    union all
    select 'R1 delete_my_account existe (fazer primeiro o rollback da 0025)'
    where exists (select 1 from pg_catalog.pg_proc f
                  join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
                  where f.proname = 'delete_my_account')
    union all
    select 'R1 politica compat_interested_count_update ja existe'
    where exists (select 1 from pg_catalog.pg_policies
                  where schemaname = 'public' and tablename = 'activities'
                    and policyname = 'compat_interested_count_update')
    union all
    select 'R1 anon tem UPDATE em activities'
    where pg_catalog.has_table_privilege('anon', 'public.activities', 'UPDATE')
       or pg_catalog.has_any_column_privilege('anon', 'public.activities', 'UPDATE')
    union all
    select 'R1 authenticated sem UPDATE de tabela (grantor = quem corre) em activities'
    where not exists (select 1 from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c
                                                           where c.oid = pg_catalog.to_regclass('public.activities'))) a
                      where pg_catalog.pg_get_userbyid(a.grantee) = 'authenticated'
                        and a.privilege_type = 'UPDATE' and a.grantor = v_me)
    union all
    select 'R1 ' || r || ' tem ' || pr || ' em active_activities'
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) pr
    where pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr)
       or (pr in ('INSERT', 'UPDATE', 'REFERENCES')
           and pg_catalog.has_any_column_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr))
    union all
    select 'R1 privilegio de coluna: ' || c.relname || ' ' || pg_catalog.pg_get_userbyid(a.grantee) || ' '
           || a.privilege_type || '(' || att.attname || ')'
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.oid in (pg_catalog.to_regclass('public.active_activities'), pg_catalog.to_regclass('public.activity_interests'))
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
    union all
    select 'R1 entrada de ACL em activity_interests: '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
           || ' ' || a.privilege_type
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c
                                where c.oid = pg_catalog.to_regclass('public.activity_interests'))) a
    where a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated')
    union all
    select 'R1 ' || r || ' sem SELECT de tabela em active_activities'
    from unnest(array['anon', 'authenticated']) r
    where not exists (select 1 from pg_catalog.pg_class c
                      cross join lateral pg_catalog.aclexplode(c.relacl) a
                      where c.oid = pg_catalog.to_regclass('public.active_activities')
                        and pg_catalog.pg_get_userbyid(a.grantee) = r and a.privilege_type = 'SELECT'
                        and a.grantor = v_me)
    union all
    select 'R1 ' || r || ' tem EXECUTE em increment_activity_interest'
    from unnest(array['anon', 'authenticated']) r
    where pg_catalog.has_function_privilege(r, 'public.increment_activity_interest(uuid, smallint)', 'EXECUTE')
  ) x;
  if v_problems is not null then
    raise exception 'Rollback 0024 abortado (nada alterado): %', v_problems;
  end if;
end;
$rb$;

drop function public.set_activity_interest(uuid, boolean);
drop function public.get_my_interests(uuid[]);

-- Texto idêntico ao da 0020
create policy "compat_interested_count_update" on public.activities
  for update to anon, authenticated
  using (true)
  with check (true);

-- Igual à 0000 (UPDATE de tabela; authenticated nunca o perdeu)
grant update on public.activities to anon;

-- Igual à 0000 (o SELECT nunca foi retirado)
grant insert, update, delete, truncate, references, trigger
  on public.active_activities to anon, authenticated;

-- Igual ao default ACL observado no staging (SEC-O-017)
grant truncate, references, trigger, maintain
  on public.activity_interests to anon, authenticated;

-- Igual à 0020
grant execute on function public.increment_activity_interest(uuid, smallint)
  to anon, authenticated;

do $post$
declare
  v_me oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    select 'R4 funcao ainda existe: ' || f.proname as p
    from pg_catalog.pg_proc f
    join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
    where f.proname in ('set_activity_interest', 'get_my_interests')
    union all
    select 'R4 politica compat diferente da 0020'
    where not exists (select 1 from pg_catalog.pg_policies p
                      where p.schemaname = 'public' and p.tablename = 'activities'
                        and p.policyname = 'compat_interested_count_update'
                        and p.cmd = 'UPDATE' and p.permissive = 'PERMISSIVE'
                        and p.roles = array['anon', 'authenticated']::name[]
                        and p.qual = 'true' and p.with_check = 'true')
    union all
    select 'R4 em falta: ' || g || ' ' || pr || ' ' || t
    from (select 'anon' as g, 'activities' as t, 'UPDATE' as pr
          union all select 'authenticated', 'activities', 'UPDATE'
          union all select g2, 'active_activities', p2
                    from unnest(array['anon', 'authenticated']) g2
                    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p2
          union all select g3, 'activity_interests', p3
                    from unnest(array['anon', 'authenticated']) g3
                    cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p3) v
    where not exists (select 1 from pg_catalog.pg_class c
                      cross join lateral pg_catalog.aclexplode(c.relacl) a
                      where c.oid = pg_catalog.to_regclass('public.' || v.t)
                        and pg_catalog.pg_get_userbyid(a.grantee) = v.g and a.privilege_type = v.pr
                        and a.grantor = v_me)
    union all
    select 'R4 EXECUTE em falta em increment_activity_interest: ' || g
    from unnest(array['anon', 'authenticated']) g
    where not exists (select 1 from pg_catalog.pg_proc f
                      cross join lateral pg_catalog.aclexplode(f.proacl) a
                      where f.oid = pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)')
                        and pg_catalog.pg_get_userbyid(a.grantee) = g and a.privilege_type = 'EXECUTE'
                        and a.grantor = v_me)
  ) x;
  if v_problems is not null then
    raise exception 'Rollback 0024 incompleto (R4), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
