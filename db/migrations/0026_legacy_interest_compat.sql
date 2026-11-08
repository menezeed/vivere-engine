-- ============================================================
-- Migration 0026 — Compatibilidade TRANSITÓRIA com versões antigas da app
--                  (caminho legado de interested_count)
--
-- REF: Lote 3 (rollout em produção), decisão Level 2 estratégia (a):
-- separar a criação das RPC (0024) da revogação do caminho legado (0027).
-- ESTADO: PROPOSTA, NÃO APLICADA em nenhum Supabase. Validada só na
-- simulação local (db/audit/local/run-lote3-compat.sh).
--
-- PORQUÊ
-- As versões da app já instaladas (mobile main c390c92 e anteriores;
-- ActivityModal.js e ActivityDetailScreen.js, handleToggleFav) marcam
-- interesse assim, sem verificar erros:
--   1. upsert/delete directo em public.activity_interests  -> JÁ FALHA
--      antes da 0024 (a P2 da 0024 exige que anon/authenticated não tenham
--      SELECT/INSERT/UPDATE/DELETE nessa tabela); nada a repor;
--   2. PATCH /activities?id=eq.<id> {interested_count: <valor em cache ± 1>}
--      como anon (sem sessão) ou authenticated (com sessão) -> funciona
--      antes da 0024 (política compat_interested_count_update + UPDATE de
--      anon da 0000 + trigger guard_activities_update) e deixa de funcionar
--      com a 0024 (falha silenciosa: o contador deixa de mexer).
-- Nenhuma versão da app chamou increment_activity_interest (git log -S no
-- repositório mobile) nem escreve em active_activities: não se repõe nada
-- disso.
--
-- O QUE FAZ (só o necessário ao passo 2)
--   * recria a política compat_interested_count_update com o texto da 0020
--     (UPDATE, anon e authenticated, using/with check true) e um COMMENT
--     que a marca como transitória (o comentário identifica o estado 0026);
--   * GRANT UPDATE (interested_count) ON public.activities TO anon — de
--     COLUNA, mais estreito que o UPDATE de tabela da 0000 (que a 0024
--     retirou e que não é reposto). authenticated já tem UPDATE de tabela
--     (mantido pela 0024 para o painel admin).
-- O trigger guard_activities_update (0020) continua a ser a protecção:
-- para quem não é admin/service_role só deixa mudar interested_count, em
-- -1/0/+1 relativamente ao valor actual, nunca abaixo de 0. As RPC da
-- 0024/0025 ficam intactas e continuam a ser o caminho das versões novas.
--
-- RISCO DO ESTADO TRANSITÓRIO (aceite pelo Level 2; ver docs/runbooks/
-- production-rollout.md e ROLLOUT-COMPAT): é a exposição que a produção
-- já tem hoje, sem agravamento —
--   * qualquer pessoa com a chave anon pode fazer +1/-1 repetidamente
--     (1 pedido = 1 unidade; sem limite por utilizador); pode inflacionar
--     ou levar a 0 o contador de qualquer actividade;
--   * o contador deriva das linhas de activity_interests: marcas legadas
--     contam +1 sem linha; quem marcou na versão antiga e volta a marcar
--     na nova conta 2 vezes; desmarcar na versão nova não retira o +1
--     legado (DELETE com ROW_COUNT 0 não decrementa).
--
-- PRÉ-CONDIÇÕES (abortam tudo antes de qualquer alteração)
--  P1 Cadeia: 0024 e 0025 aplicadas (as 3 RPC existem, dono postgres,
--     SECURITY DEFINER, EXECUTE só dono e authenticated); RLS ligado em
--     activities e activity_interests; trigger guard_activities_update
--     activo e igual ao da 0020 (tipo, função e corpo normalizado);
--     interested_count integer; políticas de activities EXACTAMENTE as da
--     0020 sem a compat (estado deixado pela 0024).
--  P2 ACL: nenhum UPDATE de tabela para anon/PUBLIC em activities e
--     nenhum privilégio de coluna de anon/authenticated/PUBLIC em
--     activities; authenticated com UPDATE de tabela (grantor = quem
--     corre); SELECT de anon/authenticated em activities e
--     active_activities; endurecimento da 0024 intacto (active_activities
--     só SELECT, activity_interests sem ACL para anon/authenticated/PUBLIC,
--     increment_activity_interest presente e sem EXECUTE para
--     anon/authenticated).
-- Qualquer diferença aborta: a decisão volta ao Level 2.
--
-- ORDEM: aplicar logo a seguir à 0025, na MESMA janela de manutenção que
-- 0023 → 0024 → 0025 (a 0025 exige que a política compat não exista, por
-- isso a 0026 tem de vir depois dela). Entre o commit da 0024 e o da 0026
-- as versões antigas falham em silêncio (o contador não mexe; a app não
-- rebenta).
--
-- Correr como `postgres`. NÃO é idempotente: reaplicar aborta em P1 (a
-- política já existe). Nota: depois da 0027 o catálogo volta a ser
-- exactamente o da 0025, por isso correr a 0026 outra vez equivale ao
-- rollback da 0027 (reabre o caminho legado): só com REF próprio.
-- ROLLBACK: 0026_legacy_interest_compat.rollback.sql (efeito igual à 0027).
-- REVOGAÇÃO DEFINITIVA: 0027_revoke_legacy_interest.sql.
-- ============================================================

begin;

-- P1/P2: estado da 0025
do $pre$
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
    select 'P1 funcao em falta: ' || s as p
    from unnest(array['public.set_activity_interest(uuid, boolean)', 'public.get_my_interests(uuid[])',
                      'public.delete_my_account()']) s
    where pg_catalog.to_regprocedure(s) is null
    union all
    select 'P1 funcao com dono/ACL/security definer inesperado: ' || f.oid::pg_catalog.regprocedure::text
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
    select 'P1 rls desligado ou tabela em falta: ' || t
    from unnest(array['activities', 'activity_interests']) t
    where not exists (select 1 from pg_catalog.pg_class c
                      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t
                        and c.relkind = 'r' and c.relrowsecurity)
    -- (c) trigger guard da 0020: é a única protecção do caminho legado
    --     (só interested_count, delta -1/0/+1, nunca negativo)
    union all
    select 'P1 trigger guard_activities_update ausente, desactivado ou diferente da 0020'
    where not exists (select 1 from pg_catalog.pg_trigger tg
                      where tg.tgrelid = v_act and tg.tgname = 'guard_activities_update'
                        and tg.tgenabled = 'O' and tg.tgtype = 19          -- ROW + BEFORE + UPDATE
                        and tg.tgfoid = pg_catalog.to_regprocedure('public.guard_activities_update()')
                        and tg.tgnargs = 0 and tg.tgqual is null
                        and tg.tgattr::text = '')               -- sem lista de colunas
    union all
    select 'P1 funcao guard_activities_update diferente da 0020 (corpo normalizado ou security definer)'
    where not exists (select 1 from pg_catalog.pg_proc f
                      where f.oid = pg_catalog.to_regprocedure('public.guard_activities_update()')
                        and f.prosecdef
                        and pg_catalog.md5(pg_catalog.btrim(pg_catalog.regexp_replace(f.prosrc, '\s+', ' ', 'g')))
                            = '0907e30220725862edb3497a9b42bb98')
    union all
    select 'P1 coluna public.activities.interested_count em falta ou nao integer'
    where not exists (select 1 from pg_catalog.pg_attribute att
                      where att.attrelid = v_act and att.attname = 'interested_count'
                        and not att.attisdropped and att.atttypid = 'pg_catalog.int4'::pg_catalog.regtype)
    -- (d) políticas de public.activities: as da 0020 sem a compat (estado
    --     0024/0025) ou com a compat recriada pela 0026
    union all
    select 'P1 politicas de activities: ' || d.k || d.pol || ' [' || d.cmd || ']'
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
    select 'P1 politica compat sem o comentario de transicao da 0026'
    where v_compat
      and coalesce(pg_catalog.obj_description(
            (select pol.oid from pg_catalog.pg_policy pol
             where pol.polrelid = v_act and pol.polname = 'compat_interested_count_update'), 'pg_policy'), '')
          <> 'TRANSITORIA (0026): caminho legado das versoes antigas da app (UPDATE directo de interested_count). Retirar com a 0027 depois dos criterios de adopcao. Nao e o estado final.'
    -- (e) privilégios necessários
    union all
    select 'P2 authenticated sem UPDATE de tabela (grantor = quem corre) em activities'
    where not exists (select 1 from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c where c.oid = v_act)) a
                      where a.grantee = v_auth and a.privilege_type = 'UPDATE' and a.grantor = v_me)
    union all
    select 'P2 ' || r || ' sem SELECT em ' || t
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['activities', 'active_activities']) t
    where not pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.' || t), 'SELECT')
    -- (f) UPDATE em activities: nenhum de tabela para anon/PUBLIC; de coluna
    --     exactamente {} (estado 0024/0025) ou {anon UPDATE(interested_count),
    --     grantor = quem corre} (estado 0026)
    union all
    select 'P2 UPDATE de tabela em activities para '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c where c.oid = v_act)) a
    where a.privilege_type = 'UPDATE' and (a.grantee = 0 or a.grantee = v_anon)
    union all
    select 'P2 ACL de coluna em activities: ' || d.k || d.g || ' ' || d.pr || '(' || d.col || ')'
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
    select 'P2 anon com UPDATE efectivo em ' || x.n::text || ' colunas de activities (esperado '
           || case when v_compat then 1 else 0 end || ')'
    from (select count(*) as n from pg_catalog.pg_attribute att
          where att.attrelid = v_act and att.attnum > 0 and not att.attisdropped
            and pg_catalog.has_column_privilege('anon', v_act, att.attnum, 'UPDATE')) x
    where x.n <> case when v_compat then 1 else 0 end
    union all
    select 'P2 anon sem UPDATE efectivo em activities.interested_count'
    where v_compat and not pg_catalog.has_column_privilege('anon', v_act, 'interested_count', 'UPDATE')
    -- (g) endurecimento da 0024 intacto (0026/0027 não lhe tocam)
    union all
    select 'P2 ' || r || ' tem ' || pr || ' em active_activities'
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) pr
    where pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr)
       or (pr in ('INSERT', 'UPDATE', 'REFERENCES')
           and pg_catalog.has_any_column_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr))
    union all
    select 'P2 entrada de ACL em activity_interests: '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
           || ' ' || a.privilege_type
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c
                                where c.oid = pg_catalog.to_regclass('public.activity_interests'))) a
    where a.grantee = 0 or a.grantee in (v_anon, v_auth)
    union all
    select 'P2 privilegio de coluna: ' || c.relname || ' '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
           || ' ' || a.privilege_type || '(' || att.attname || ')'
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.oid in (pg_catalog.to_regclass('public.active_activities'), pg_catalog.to_regclass('public.activity_interests'))
      and (a.grantee = 0 or a.grantee in (v_anon, v_auth))
    union all
    select 'P2 funcao public.increment_activity_interest(uuid, smallint) ausente'
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is null
    union all
    select 'P2 ' || r || ' tem EXECUTE em increment_activity_interest'
    from unnest(array['anon', 'authenticated']) r
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is not null
      and pg_catalog.has_function_privilege(r, 'public.increment_activity_interest(uuid, smallint)', 'EXECUTE')
  ) x;
  if v_problems is not null then
    raise exception '0026 abortada (pre-condicoes; nada alterado): %', v_problems;
  end if;
end;
$pre$;

-- Texto idêntico ao da 0020; o comentário marca o estado transitório.
create policy "compat_interested_count_update" on public.activities
  for update to anon, authenticated
  using (true)
  with check (true);

comment on policy "compat_interested_count_update" on public.activities is
  'TRANSITORIA (0026): caminho legado das versoes antigas da app (UPDATE directo de interested_count). Retirar com a 0027 depois dos criterios de adopcao. Nao e o estado final.';

-- De coluna (mais estreito que o UPDATE de tabela da 0000): o app antigo
-- só envia interested_count. authenticated já tem UPDATE de tabela.
grant update (interested_count) on public.activities to anon;

-- Verificação final: estado da 0026
do $post$
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
    select 'V funcao em falta: ' || s as p
    from unnest(array['public.set_activity_interest(uuid, boolean)', 'public.get_my_interests(uuid[])',
                      'public.delete_my_account()']) s
    where pg_catalog.to_regprocedure(s) is null
    union all
    select 'V funcao com dono/ACL/security definer inesperado: ' || f.oid::pg_catalog.regprocedure::text
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
    select 'V rls desligado ou tabela em falta: ' || t
    from unnest(array['activities', 'activity_interests']) t
    where not exists (select 1 from pg_catalog.pg_class c
                      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t
                        and c.relkind = 'r' and c.relrowsecurity)
    -- (c) trigger guard da 0020: é a única protecção do caminho legado
    --     (só interested_count, delta -1/0/+1, nunca negativo)
    union all
    select 'V trigger guard_activities_update ausente, desactivado ou diferente da 0020'
    where not exists (select 1 from pg_catalog.pg_trigger tg
                      where tg.tgrelid = v_act and tg.tgname = 'guard_activities_update'
                        and tg.tgenabled = 'O' and tg.tgtype = 19          -- ROW + BEFORE + UPDATE
                        and tg.tgfoid = pg_catalog.to_regprocedure('public.guard_activities_update()')
                        and tg.tgnargs = 0 and tg.tgqual is null
                        and tg.tgattr::text = '')               -- sem lista de colunas
    union all
    select 'V funcao guard_activities_update diferente da 0020 (corpo normalizado ou security definer)'
    where not exists (select 1 from pg_catalog.pg_proc f
                      where f.oid = pg_catalog.to_regprocedure('public.guard_activities_update()')
                        and f.prosecdef
                        and pg_catalog.md5(pg_catalog.btrim(pg_catalog.regexp_replace(f.prosrc, '\s+', ' ', 'g')))
                            = '0907e30220725862edb3497a9b42bb98')
    union all
    select 'V coluna public.activities.interested_count em falta ou nao integer'
    where not exists (select 1 from pg_catalog.pg_attribute att
                      where att.attrelid = v_act and att.attname = 'interested_count'
                        and not att.attisdropped and att.atttypid = 'pg_catalog.int4'::pg_catalog.regtype)
    -- (d) políticas de public.activities: as da 0020 sem a compat (estado
    --     0024/0025) ou com a compat recriada pela 0026
    union all
    select 'V politicas de activities: ' || d.k || d.pol || ' [' || d.cmd || ']'
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
    select 'V politica compat sem o comentario de transicao da 0026'
    where v_compat
      and coalesce(pg_catalog.obj_description(
            (select pol.oid from pg_catalog.pg_policy pol
             where pol.polrelid = v_act and pol.polname = 'compat_interested_count_update'), 'pg_policy'), '')
          <> 'TRANSITORIA (0026): caminho legado das versoes antigas da app (UPDATE directo de interested_count). Retirar com a 0027 depois dos criterios de adopcao. Nao e o estado final.'
    -- (e) privilégios necessários
    union all
    select 'V authenticated sem UPDATE de tabela (grantor = quem corre) em activities'
    where not exists (select 1 from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c where c.oid = v_act)) a
                      where a.grantee = v_auth and a.privilege_type = 'UPDATE' and a.grantor = v_me)
    union all
    select 'V ' || r || ' sem SELECT em ' || t
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['activities', 'active_activities']) t
    where not pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.' || t), 'SELECT')
    -- (f) UPDATE em activities: nenhum de tabela para anon/PUBLIC; de coluna
    --     exactamente {} (estado 0024/0025) ou {anon UPDATE(interested_count),
    --     grantor = quem corre} (estado 0026)
    union all
    select 'V UPDATE de tabela em activities para '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c where c.oid = v_act)) a
    where a.privilege_type = 'UPDATE' and (a.grantee = 0 or a.grantee = v_anon)
    union all
    select 'V ACL de coluna em activities: ' || d.k || d.g || ' ' || d.pr || '(' || d.col || ')'
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
    select 'V anon com UPDATE efectivo em ' || x.n::text || ' colunas de activities (esperado '
           || case when v_compat then 1 else 0 end || ')'
    from (select count(*) as n from pg_catalog.pg_attribute att
          where att.attrelid = v_act and att.attnum > 0 and not att.attisdropped
            and pg_catalog.has_column_privilege('anon', v_act, att.attnum, 'UPDATE')) x
    where x.n <> case when v_compat then 1 else 0 end
    union all
    select 'V anon sem UPDATE efectivo em activities.interested_count'
    where v_compat and not pg_catalog.has_column_privilege('anon', v_act, 'interested_count', 'UPDATE')
    -- (g) endurecimento da 0024 intacto (0026/0027 não lhe tocam)
    union all
    select 'V ' || r || ' tem ' || pr || ' em active_activities'
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) pr
    where pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr)
       or (pr in ('INSERT', 'UPDATE', 'REFERENCES')
           and pg_catalog.has_any_column_privilege(r, pg_catalog.to_regclass('public.active_activities'), pr))
    union all
    select 'V entrada de ACL em activity_interests: '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
           || ' ' || a.privilege_type
    from pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c
                                where c.oid = pg_catalog.to_regclass('public.activity_interests'))) a
    where a.grantee = 0 or a.grantee in (v_anon, v_auth)
    union all
    select 'V privilegio de coluna: ' || c.relname || ' '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
           || ' ' || a.privilege_type || '(' || att.attname || ')'
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.oid in (pg_catalog.to_regclass('public.active_activities'), pg_catalog.to_regclass('public.activity_interests'))
      and (a.grantee = 0 or a.grantee in (v_anon, v_auth))
    union all
    select 'V funcao public.increment_activity_interest(uuid, smallint) ausente'
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is null
    union all
    select 'V ' || r || ' tem EXECUTE em increment_activity_interest'
    from unnest(array['anon', 'authenticated']) r
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is not null
      and pg_catalog.has_function_privilege(r, 'public.increment_activity_interest(uuid, smallint)', 'EXECUTE')
  ) x;
  if v_problems is not null then
    raise exception '0026 incompleta (verificacao final), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
