-- ============================================================
-- Rollback 0026 — retirar o caminho legado transitório de interested_count
--
-- REF: Lote 3 (rollout em produção). ESTADO: PROPOSTA, NÃO APLICADA em
-- nenhum Supabase. Validado só na simulação local.
--
-- Efeito igual ao da 0027 (repõe exactamente o estado deixado pela 0025:
-- política compat inexistente, anon sem UPDATE em activities). Usar para
-- desfazer a 0026 por decisão operacional (ex.: abuso do contador durante
-- a janela de transição); para o fim normal da transição usar a 0027,
-- que fica registada na cadeia.
--
-- PORQUE É SEGURO
--  R1 confirma o estado deixado pela 0026 (mesmas verificações da
--     verificação final da 0026: política compat com o texto da 0020 e o
--     comentário de transição; anon só com UPDATE(interested_count),
--     grantor = quem corre; RPC, trigger e endurecimento da 0024 intactos).
--     Qualquer diferença aborta sem alterar nada.
--  R3 drop policy + revoke do privilégio de coluna.
--  R4 confirma o estado da 0025 (mesmas verificações da P1/P2 da 0026).
--
-- DADOS: o interested_count escrito pelo caminho legado fica como está.
-- Correr com o mesmo papel que aplicou a 0026 (no Supabase, `postgres`).
-- ============================================================

begin;

-- R1: estado da 0026
do $rb$
declare
  -- estado esperado: o deixado pela 0026 (caminho legado transitório aberto)
  v_compat   boolean := true;
  v_me       oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);
  v_anon     oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = 'anon');
  v_auth     oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = 'authenticated');
  v_act      oid := pg_catalog.to_regclass('public.activities');
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    -- (a) RPC do Lote 2 presentes (0024 e 0025 aplicadas), dono postgres,
    --     SECURITY DEFINER, EXECUTE só para o dono e authenticated
    select 'R1 funcao em falta: ' || s as p
    from unnest(array['public.set_activity_interest(uuid, boolean)', 'public.get_my_interests(uuid[])',
                      'public.delete_my_account()']) s
    where pg_catalog.to_regprocedure(s) is null
    union all
    select 'R1 funcao com dono/ACL/security definer inesperado: ' || f.oid::pg_catalog.regprocedure::text
    from pg_catalog.pg_proc f
    where f.oid in (pg_catalog.to_regprocedure('public.set_activity_interest(uuid, boolean)'),
                    pg_catalog.to_regprocedure('public.get_my_interests(uuid[])'),
                    pg_catalog.to_regprocedure('public.delete_my_account()'))
      and (pg_catalog.pg_get_userbyid(f.proowner) <> 'postgres' or not f.prosecdef
           or array(select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
                           || ':' || a.privilege_type
                    from pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                    order by 1)
              <> array['authenticated:EXECUTE', 'postgres:EXECUTE'])
    -- (b) RLS ligado
    union all
    select 'R1 rls desligado ou tabela em falta: ' || t
    from unnest(array['activities', 'activity_interests']) t
    where not exists (select 1 from pg_catalog.pg_class c
                      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t
                        and c.relkind = 'r' and c.relrowsecurity)
    -- (c) trigger guard da 0020: é a única protecção do caminho legado
    --     (só interested_count, delta -1/0/+1, nunca negativo)
    union all
    select 'R1 trigger guard_activities_update ausente, desactivado ou diferente da 0020'
    where not exists (select 1 from pg_catalog.pg_trigger tg
                      where tg.tgrelid = v_act and tg.tgname = 'guard_activities_update'
                        and tg.tgenabled = 'O' and tg.tgtype = 19          -- ROW + BEFORE + UPDATE
                        and tg.tgfoid = pg_catalog.to_regprocedure('public.guard_activities_update()')
                        and tg.tgnargs = 0 and tg.tgqual is null
                        and tg.tgattr::text = '')               -- sem lista de colunas
    union all
    select 'R1 funcao guard_activities_update diferente da 0020 (corpo normalizado ou security definer)'
    where not exists (select 1 from pg_catalog.pg_proc f
                      where f.oid = pg_catalog.to_regprocedure('public.guard_activities_update()')
                        and f.prosecdef
                        and pg_catalog.md5(pg_catalog.btrim(pg_catalog.regexp_replace(f.prosrc, '\s+', ' ', 'g')))
                            = '0907e30220725862edb3497a9b42bb98')
    union all
    select 'R1 coluna public.activities.interested_count em falta ou nao integer'
    where not exists (select 1 from pg_catalog.pg_attribute att
                      where att.attrelid = v_act and att.attname = 'interested_count'
                        and not att.attisdropped and att.atttypid = 'pg_catalog.int4'::pg_catalog.regtype)
    -- (d) políticas de public.activities: as da 0020 sem a compat (estado
    --     0024/0025) ou com a compat recriada pela 0026
    union all
    select 'R1 politicas de activities: ' || d.k || d.pol || ' [' || d.cmd || ']'
    from (
      with expected(pol, cmd, perm, roles, qual, chk) as (
        select * from (values
          ('Leitura pública de atividades', 'SELECT', 'PERMISSIVE', 'public', 'true', '-'),
          ('admin_role_all', 'ALL', 'PERMISSIVE', 'authenticated',
            '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)',
            '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)')) v
        union all
        select 'compat_interested_count_update', 'UPDATE', 'PERMISSIVE', 'anon,authenticated', 'true', 'true'
        where v_compat
      ),
      actual as (
        select p.policyname::text, p.cmd, p.permissive,
               pg_catalog.array_to_string(array(select r::text from unnest(p.roles) r order by 1), ','),
               coalesce(p.qual, '-'), coalesce(p.with_check, '-')
        from pg_catalog.pg_policies p
        where p.schemaname = 'public' and p.tablename = 'activities'
      )
      (select 'esperada e ausente/diferente: ' as k, * from expected
       except select 'esperada e ausente/diferente: ', * from actual)
      union all
      (select 'inesperada: ', * from actual
       except select 'inesperada: ', * from expected)
    ) d
    union all
    select 'R1 politica compat sem o comentario de transicao da 0026'
    where v_compat
      and coalesce(pg_catalog.obj_description(
            (select pol.oid from pg_catalog.pg_policy pol
             where pol.polrelid = v_act and pol.polname = 'compat_interested_count_update'), 'pg_policy'), '')
          <> 'TRANSITORIA (0026): caminho legado das versoes antigas da app (UPDATE directo de interested_count). Retirar com a 0027 depois dos criterios de adopcao. Nao e o estado final.'
    -- (e) privilégios necessários
    union all
    select 'R1 authenticated sem UPDATE de tabela (grantor = quem corre) em activities'
    where not exists (select 1 from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c where c.oid = v_act)) a
                      where a.grantee = v_auth and a.privilege_type = 'UPDATE' and a.grantor = v_me)
    union all
    select 'R1 ' || r || ' sem SELECT em ' || t
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['activities', 'active_activities']) t
    where not pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.' || t), 'SELECT')
    -- (f) UPDATE em activities: nenhum de tabela para anon/PUBLIC; de coluna
    --     exactamente {} (estado 0024/0025) ou {anon UPDATE(interested_count),
    --     grantor = quem corre} (estado 0026)
    union all
    select 'R1 UPDATE de tabela em activities para '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c where c.oid = v_act)) a
    where a.privilege_type = 'UPDATE' and (a.grantee = 0 or a.grantee = v_anon)
    union all
    select 'R1 ACL de coluna em activities: ' || d.k || d.g || ' ' || d.pr || '(' || d.col || ')'
    from (
      with expected(g, col, pr, gr) as (
        select 'anon'::text, 'interested_count'::text, 'UPDATE'::text, v_me where v_compat
      ),
      actual as (
        select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end,
               att.attname::text, a.privilege_type::text, a.grantor
        from pg_catalog.pg_attribute att
        cross join lateral pg_catalog.aclexplode(att.attacl) a
        where att.attrelid = v_act and att.attnum > 0 and not att.attisdropped
          and (a.grantee = 0 or a.grantee in (v_anon, v_auth))
      )
      (select 'esperada e ausente/outro grantor: ' as k, * from expected
       except select 'esperada e ausente/outro grantor: ', * from actual)
      union all
      (select 'inesperada: ', * from actual
       except select 'inesperada: ', * from expected)
    ) d
    union all
    select 'R1 anon com UPDATE efectivo em ' || x.n::text || ' colunas de activities (esperado '
           || case when v_compat then 1 else 0 end || ')'
    from (select count(*) as n from pg_catalog.pg_attribute att
          where att.attrelid = v_act and att.attnum > 0 and not att.attisdropped
            and pg_catalog.has_column_privilege('anon', v_act, att.attnum, 'UPDATE')) x
    where x.n <> case when v_compat then 1 else 0 end
    union all
    select 'R1 anon sem UPDATE efectivo em activities.interested_count'
    where v_compat and not pg_catalog.has_column_privilege('anon', v_act, 'interested_count', 'UPDATE')
    -- (g) endurecimento da 0024 intacto (0026/0027 não lhe tocam)
    union all
    select 'R1 ' || r || ' tem ' || pr || ' em active_activities'
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) pr
    where pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr)
       or (pr in ('INSERT', 'UPDATE', 'REFERENCES')
           and pg_catalog.has_any_column_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr))
    union all
    select 'R1 entrada de ACL em activity_interests: '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
           || ' ' || a.privilege_type
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c
                                where c.oid = pg_catalog.to_regclass('public.activity_interests'))) a
    where a.grantee = 0 or a.grantee in (v_anon, v_auth)
    union all
    select 'R1 privilegio de coluna: ' || c.relname || ' '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
           || ' ' || a.privilege_type || '(' || att.attname || ')'
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.oid in (pg_catalog.to_regclass('public.active_activities'), pg_catalog.to_regclass('public.activity_interests'))
      and (a.grantee = 0 or a.grantee in (v_anon, v_auth))
    union all
    select 'R1 funcao public.increment_activity_interest(uuid, smallint) ausente'
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is null
    union all
    select 'R1 ' || r || ' tem EXECUTE em increment_activity_interest'
    from unnest(array['anon', 'authenticated']) r
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is not null
      and pg_catalog.has_function_privilege(r, 'public.increment_activity_interest(uuid, smallint)', 'EXECUTE')
  ) x;
  if v_problems is not null then
    raise exception 'Rollback 0026 abortado (nada alterado): %', v_problems;
  end if;
end;
$rb$;

-- R3
drop policy "compat_interested_count_update" on public.activities;

revoke update (interested_count) on public.activities from anon;

-- R4: estado da 0025
do $post$
declare
  -- estado esperado: o deixado pela 0024/0025 (sem caminho legado)
  v_compat   boolean := false;
  v_me       oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);
  v_anon     oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = 'anon');
  v_auth     oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = 'authenticated');
  v_act      oid := pg_catalog.to_regclass('public.activities');
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    -- (a) RPC do Lote 2 presentes (0024 e 0025 aplicadas), dono postgres,
    --     SECURITY DEFINER, EXECUTE só para o dono e authenticated
    select 'R4 funcao em falta: ' || s as p
    from unnest(array['public.set_activity_interest(uuid, boolean)', 'public.get_my_interests(uuid[])',
                      'public.delete_my_account()']) s
    where pg_catalog.to_regprocedure(s) is null
    union all
    select 'R4 funcao com dono/ACL/security definer inesperado: ' || f.oid::pg_catalog.regprocedure::text
    from pg_catalog.pg_proc f
    where f.oid in (pg_catalog.to_regprocedure('public.set_activity_interest(uuid, boolean)'),
                    pg_catalog.to_regprocedure('public.get_my_interests(uuid[])'),
                    pg_catalog.to_regprocedure('public.delete_my_account()'))
      and (pg_catalog.pg_get_userbyid(f.proowner) <> 'postgres' or not f.prosecdef
           or array(select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
                           || ':' || a.privilege_type
                    from pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                    order by 1)
              <> array['authenticated:EXECUTE', 'postgres:EXECUTE'])
    -- (b) RLS ligado
    union all
    select 'R4 rls desligado ou tabela em falta: ' || t
    from unnest(array['activities', 'activity_interests']) t
    where not exists (select 1 from pg_catalog.pg_class c
                      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t
                        and c.relkind = 'r' and c.relrowsecurity)
    -- (c) trigger guard da 0020: é a única protecção do caminho legado
    --     (só interested_count, delta -1/0/+1, nunca negativo)
    union all
    select 'R4 trigger guard_activities_update ausente, desactivado ou diferente da 0020'
    where not exists (select 1 from pg_catalog.pg_trigger tg
                      where tg.tgrelid = v_act and tg.tgname = 'guard_activities_update'
                        and tg.tgenabled = 'O' and tg.tgtype = 19          -- ROW + BEFORE + UPDATE
                        and tg.tgfoid = pg_catalog.to_regprocedure('public.guard_activities_update()')
                        and tg.tgnargs = 0 and tg.tgqual is null
                        and tg.tgattr::text = '')               -- sem lista de colunas
    union all
    select 'R4 funcao guard_activities_update diferente da 0020 (corpo normalizado ou security definer)'
    where not exists (select 1 from pg_catalog.pg_proc f
                      where f.oid = pg_catalog.to_regprocedure('public.guard_activities_update()')
                        and f.prosecdef
                        and pg_catalog.md5(pg_catalog.btrim(pg_catalog.regexp_replace(f.prosrc, '\s+', ' ', 'g')))
                            = '0907e30220725862edb3497a9b42bb98')
    union all
    select 'R4 coluna public.activities.interested_count em falta ou nao integer'
    where not exists (select 1 from pg_catalog.pg_attribute att
                      where att.attrelid = v_act and att.attname = 'interested_count'
                        and not att.attisdropped and att.atttypid = 'pg_catalog.int4'::pg_catalog.regtype)
    -- (d) políticas de public.activities: as da 0020 sem a compat (estado
    --     0024/0025) ou com a compat recriada pela 0026
    union all
    select 'R4 politicas de activities: ' || d.k || d.pol || ' [' || d.cmd || ']'
    from (
      with expected(pol, cmd, perm, roles, qual, chk) as (
        select * from (values
          ('Leitura pública de atividades', 'SELECT', 'PERMISSIVE', 'public', 'true', '-'),
          ('admin_role_all', 'ALL', 'PERMISSIVE', 'authenticated',
            '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)',
            '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)')) v
        union all
        select 'compat_interested_count_update', 'UPDATE', 'PERMISSIVE', 'anon,authenticated', 'true', 'true'
        where v_compat
      ),
      actual as (
        select p.policyname::text, p.cmd, p.permissive,
               pg_catalog.array_to_string(array(select r::text from unnest(p.roles) r order by 1), ','),
               coalesce(p.qual, '-'), coalesce(p.with_check, '-')
        from pg_catalog.pg_policies p
        where p.schemaname = 'public' and p.tablename = 'activities'
      )
      (select 'esperada e ausente/diferente: ' as k, * from expected
       except select 'esperada e ausente/diferente: ', * from actual)
      union all
      (select 'inesperada: ', * from actual
       except select 'inesperada: ', * from expected)
    ) d
    union all
    select 'R4 politica compat sem o comentario de transicao da 0026'
    where v_compat
      and coalesce(pg_catalog.obj_description(
            (select pol.oid from pg_catalog.pg_policy pol
             where pol.polrelid = v_act and pol.polname = 'compat_interested_count_update'), 'pg_policy'), '')
          <> 'TRANSITORIA (0026): caminho legado das versoes antigas da app (UPDATE directo de interested_count). Retirar com a 0027 depois dos criterios de adopcao. Nao e o estado final.'
    -- (e) privilégios necessários
    union all
    select 'R4 authenticated sem UPDATE de tabela (grantor = quem corre) em activities'
    where not exists (select 1 from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c where c.oid = v_act)) a
                      where a.grantee = v_auth and a.privilege_type = 'UPDATE' and a.grantor = v_me)
    union all
    select 'R4 ' || r || ' sem SELECT em ' || t
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['activities', 'active_activities']) t
    where not pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.' || t), 'SELECT')
    -- (f) UPDATE em activities: nenhum de tabela para anon/PUBLIC; de coluna
    --     exactamente {} (estado 0024/0025) ou {anon UPDATE(interested_count),
    --     grantor = quem corre} (estado 0026)
    union all
    select 'R4 UPDATE de tabela em activities para '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c where c.oid = v_act)) a
    where a.privilege_type = 'UPDATE' and (a.grantee = 0 or a.grantee = v_anon)
    union all
    select 'R4 ACL de coluna em activities: ' || d.k || d.g || ' ' || d.pr || '(' || d.col || ')'
    from (
      with expected(g, col, pr, gr) as (
        select 'anon'::text, 'interested_count'::text, 'UPDATE'::text, v_me where v_compat
      ),
      actual as (
        select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end,
               att.attname::text, a.privilege_type::text, a.grantor
        from pg_catalog.pg_attribute att
        cross join lateral pg_catalog.aclexplode(att.attacl) a
        where att.attrelid = v_act and att.attnum > 0 and not att.attisdropped
          and (a.grantee = 0 or a.grantee in (v_anon, v_auth))
      )
      (select 'esperada e ausente/outro grantor: ' as k, * from expected
       except select 'esperada e ausente/outro grantor: ', * from actual)
      union all
      (select 'inesperada: ', * from actual
       except select 'inesperada: ', * from expected)
    ) d
    union all
    select 'R4 anon com UPDATE efectivo em ' || x.n::text || ' colunas de activities (esperado '
           || case when v_compat then 1 else 0 end || ')'
    from (select count(*) as n from pg_catalog.pg_attribute att
          where att.attrelid = v_act and att.attnum > 0 and not att.attisdropped
            and pg_catalog.has_column_privilege('anon', v_act, att.attnum, 'UPDATE')) x
    where x.n <> case when v_compat then 1 else 0 end
    union all
    select 'R4 anon sem UPDATE efectivo em activities.interested_count'
    where v_compat and not pg_catalog.has_column_privilege('anon', v_act, 'interested_count', 'UPDATE')
    -- (g) endurecimento da 0024 intacto (0026/0027 não lhe tocam)
    union all
    select 'R4 ' || r || ' tem ' || pr || ' em active_activities'
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) pr
    where pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr)
       or (pr in ('INSERT', 'UPDATE', 'REFERENCES')
           and pg_catalog.has_any_column_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr))
    union all
    select 'R4 entrada de ACL em activity_interests: '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
           || ' ' || a.privilege_type
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c
                                where c.oid = pg_catalog.to_regclass('public.activity_interests'))) a
    where a.grantee = 0 or a.grantee in (v_anon, v_auth)
    union all
    select 'R4 privilegio de coluna: ' || c.relname || ' '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
           || ' ' || a.privilege_type || '(' || att.attname || ')'
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.oid in (pg_catalog.to_regclass('public.active_activities'), pg_catalog.to_regclass('public.activity_interests'))
      and (a.grantee = 0 or a.grantee in (v_anon, v_auth))
    union all
    select 'R4 funcao public.increment_activity_interest(uuid, smallint) ausente'
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is null
    union all
    select 'R4 ' || r || ' tem EXECUTE em increment_activity_interest'
    from unnest(array['anon', 'authenticated']) r
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is not null
      and pg_catalog.has_function_privilege(r, 'public.increment_activity_interest(uuid, smallint)', 'EXECUTE')
  ) x;
  if v_problems is not null then
    raise exception 'Rollback 0026 incompleto (R4), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
