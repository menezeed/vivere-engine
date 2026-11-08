-- ============================================================
-- Testes de abuso SÓ LOCAIS — Lote 2 (interesses + exclusão de conta)
-- Contrato: CONTRATO-LOTE2 v1 + v1.1 (v1.1 prevalece).
--
-- Alvo: public.set_activity_interest(uuid, boolean),
--       public.get_my_interests(uuid[]),
--       public.delete_my_account()
-- e os privilégios associados (activities, active_activities,
-- activity_interests, increment_activity_interest).
--
-- Recusa correr fora da simulação local (vivere.sim = 'local').
-- Correr como superutilizador local (supabase_admin) numa base
-- descartável já com supabase-sim.sql + migrações 0000..0025:
--   psql -U supabase_admin -d l2s_x -v ON_ERROR_STOP=1 -f lote2-abuse-tests.local.sql
-- Tudo corre dentro de BEGIN ... ROLLBACK: não deixa dados. Cada caso
-- define o papel (SET LOCAL ROLE) e os claims (request.jwt.claims,
-- local à transacção). Resultado: PASS / FAIL / WARN / INFO por caso e
-- contagem final; termina em erro (exit != 0) se houver algum FAIL.
-- A concorrência (várias sessões) está em run-lote2-abuse.sh.
-- ============================================================
\set ON_ERROR_STOP 1
begin;

do $main$
declare
  -- utilizadores
  uA uuid := '5ec00000-0000-4000-8000-00000000000a';  -- normal; e-mail com '_' (armadilha LIKE)
  uB uuid := '5ec00000-0000-4000-8000-00000000000b';  -- normal
  uC uuid := '5ec00000-0000-4000-8000-00000000000c';  -- gerido (raw_app_meta_data.role)
  uD uuid := '5ec00000-0000-4000-8000-00000000000d';  -- só sessões não recentes/inválidas
  uE uuid := '5ec00000-0000-4000-8000-00000000000e';  -- JWT diz role=admin, BD sem role
  uG uuid := '5ec00000-0000-4000-8000-000000000010';  -- e-mail NULL (ex.: login por telefone)
  uH uuid := '5ec00000-0000-4000-8000-000000000011';  -- JWT com e-mail de outra pessoa
  uX uuid := '5ec00000-0000-4000-8000-0000000000ff';  -- não existe em auth.users
  -- sessões
  sA    uuid := '5e550000-0000-4000-8000-00000000000a';
  sB    uuid := '5e550000-0000-4000-8000-00000000000b';
  sC    uuid := '5e550000-0000-4000-8000-00000000000c';
  sDold uuid := '5e550000-0000-4000-8000-0000000000d1';  -- criada há 10 min, refresh agora
  sDexp uuid := '5e550000-0000-4000-8000-0000000000d2';  -- recente mas not_after no passado
  sDrev uuid := '5e550000-0000-4000-8000-0000000000d3';  -- recente, depois apagada (revogada)
  sD6   uuid := '5e550000-0000-4000-8000-0000000000d4';  -- criada há 6 min
  sE    uuid := '5e550000-0000-4000-8000-00000000000e';  -- criada há 4 min (limite, deve passar)
  sG    uuid := '5e550000-0000-4000-8000-000000000010';
  sH    uuid := '5e550000-0000-4000-8000-000000000011';
  -- actividades
  a1  uuid := 'ac700000-0000-4000-8000-000000000001';
  a2  uuid := 'ac700000-0000-4000-8000-000000000002';
  a3  uuid := 'ac700000-0000-4000-8000-000000000003';
  a4  uuid := 'ac700000-0000-4000-8000-000000000004';  -- interested_count NULL (legado)
  a5  uuid := 'ac700000-0000-4000-8000-000000000005';  -- contador 0 mas com linha legada (deriva)
  aIn uuid := 'ac700000-0000-4000-8000-000000000009';  -- inactiva (fora de active_activities)
  aNo uuid := 'ac700000-0000-4000-8000-0000000000ff';  -- não existe
  -- sugestões
  gA1   uuid := '56600000-0000-4000-8000-0000000000a1';
  gLike uuid := '56600000-0000-4000-8000-0000000000a2';
  gB    uuid := '56600000-0000-4000-8000-0000000000b1';
  gAnon uuid := '56600000-0000-4000-8000-0000000000c1';
  r text; r2 text; n int; n2 int; mn int; mx int; i int; v_ok boolean;
  v_lit text; v_oid oid; v_rec record; v_list text; v_cnt_a1 int;
  v_sig text;
begin
  if coalesce(current_setting('vivere.sim', true), '') <> 'local' then
    raise exception 'Recusado: script só para a simulação local (vivere.sim).';
  end if;

  create temp table t_res (seq serial, id text, status text, descr text, evidence text);

  -- q(): corre p_sql como p_role com p_claims; devolve 'OK:<linhas>' ou 'ERR:<sqlstate>:<msg>'
  create function pg_temp.q(p_role text, p_claims jsonb, p_sql text) returns text
  language plpgsql as $f$
  declare r text; n bigint;
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    execute format('set local role %I', p_role);
    begin
      if p_sql ~* '^\s*(select|with)\s' then
        execute 'select coalesce(string_agg(s::text, '';'' order by s::text), '''') from ('
                || p_sql || ') s' into r;
        r := 'OK:' || r;
      else
        execute p_sql;
        get diagnostics n = row_count;
        r := 'OK:rows=' || n;
      end if;
    exception when others then
      r := 'ERR:' || sqlstate || ':' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return r;
  end $f$;

  -- regista um resultado
  create function pg_temp.rec(p_id text, p_status text, p_descr text, p_ev text) returns void
  language sql as $f$ insert into t_res(id, status, descr, evidence) values (p_id, p_status, p_descr, left(p_ev, 300)) $f$;

  -- asserção booleana (p_sev = estado se falhar: FAIL ou WARN)
  create function pg_temp.chk(p_id text, p_descr text, p_cond boolean, p_ev text, p_sev text default 'FAIL') returns void
  language sql as $f$
    select pg_temp.rec(p_id, case when coalesce(p_cond, false) then 'PASS' else p_sev end, p_descr, coalesce(p_ev, ''))
  $f$;

  -- expect(): p_states = 'OK' ou SQLSTATE(s) alternativos separados por '|', ex. 'P0002|22023'
  create function pg_temp.expect(p_id text, p_descr text, p_role text, p_claims jsonb, p_sql text,
                                 p_states text, p_msg text default null, p_sev text default 'FAIL') returns text
  language plpgsql as $f$
  declare r text; alts text; ok boolean;
  begin
    r := pg_temp.q(p_role, p_claims, p_sql);
    select string_agg(case when t = 'OK' then 'OK:' else 'ERR:' || t || ':' end, '|')
      into alts from unnest(string_to_array(p_states, '|')) t;
    ok := r ~ ('^(' || alts || ')');
    if ok and p_msg is not null and position(p_msg in r) = 0 then
      perform pg_temp.rec(p_id, 'WARN', p_descr || ' [SQLSTATE ok; mensagem difere do contrato: ' || p_msg || ']', r);
    else
      perform pg_temp.rec(p_id, case when ok then 'PASS' else p_sev end,
                          p_descr || ' [esperado ' || p_states || coalesce(' ' || p_msg, '') || ']', r);
    end if;
    return r;
  end $f$;

  -- claims de um utilizador autenticado
  create function pg_temp.cl(p_sub uuid, p_sid text default null, p_extra jsonb default '{}') returns jsonb
  language sql as $f$
    select jsonb_strip_nulls(jsonb_build_object('role', 'authenticated', 'aud', 'authenticated',
                                                'sub', p_sub, 'session_id', p_sid)) || p_extra
  $f$;

  create function pg_temp.cnt(p_act uuid) returns int language sql as $f$
    select interested_count from public.activities where id = p_act $f$;

  create function pg_temp.rows_(p_act uuid, p_user uuid) returns int language sql as $f$
    select count(*)::int from public.activity_interests where activity_id = p_act and user_id = p_user $f$;

  -- ==========================================================
  -- FIXTURES (superutilizador)
  -- ==========================================================
  insert into auth.users(id, email, raw_app_meta_data) values
    (uA, 'a_1@x.test', '{"provider":"email","providers":["email"]}'),
    (uB, 'b@x.test',   '{"provider":"email"}'),
    (uC, 'c@x.test',   '{"provider":"email","role":"reviewer"}'),
    (uD, 'd@x.test',   '{"provider":"email"}'),
    (uE, 'e@x.test',   '{"provider":"google"}'),
    (uG, null,         '{"provider":"phone"}'),
    (uH, 'h@x.test',   '{"provider":"email"}');
  -- Decisão 5: a anonimização exige e-mail confirmado.
  update auth.users set email_confirmed_at = now() where email is not null;

  insert into auth.sessions(id, user_id, created_at, updated_at, not_after, refreshed_at) values
    (sA,    uA, now(),                       now(), null, null),
    (sB,    uB, now(),                       now(), null, null),
    (sC,    uC, now(),                       now(), null, null),
    (sDold, uD, now() - interval '10 minutes', now(), null, (now() at time zone 'UTC')::timestamp),
    (sDexp, uD, now(),                       now(), now() - interval '1 minute', null),
    (sDrev, uD, now(),                       now(), null, null),
    (sD6,   uD, now() - interval '6 minutes', now(), null, null),
    (sE,    uE, now() - interval '4 minutes', now(), null, null),
    (sG,    uG, now(),                       now(), null, null),
    (sH,    uH, now(),                       now(), null, null);

  insert into public.activities(id, title, start_date, recurrence_type, interested_count) values
    (a1,  'L2S a1', now() + interval '7 days', 'none', 0),
    (a2,  'L2S a2', now() + interval '7 days', 'none', 0),
    (a3,  'L2S a3', now() + interval '7 days', 'none', 0),
    (a4,  'L2S a4 null', now() + interval '7 days', 'none', null),
    (a5,  'L2S a5 drift', now() + interval '7 days', 'none', 0);
  insert into public.activities(id, title, start_date, end_date, recurrence_type, interested_count) values
    (aIn, 'L2S inactive', now() - interval '30 days', now() - interval '10 days', 'none', 0);

  insert into public.activity_interests(activity_id, user_id) values (a5, uA);              -- linha legada
  insert into public.activity_interests(activity_id, device_id) values (a1, 'dev-legacy'); -- linha anónima legada
  insert into public.favorites(user_id, activity_id) values (uA, a1), (uB, a1);

  insert into public.suggestions(id, title, location, phone, email, comment) values
    (gA1,   'Sugestao A', 'Lisboa', '911000001', 'A_1@X.test', 'comentario A'),
    (gLike, 'Sugestao L', 'Porto',  '911000002', 'aX1@x.test', 'manter'),
    (gB,    'Sugestao B', 'Faro',   '911000003', 'b@x.test',   'manter'),
    (gAnon, 'Sugestao N', 'Braga',  '911000004', null,         'manter');

  -- ==========================================================
  -- F. Higiene SECURITY DEFINER (catálogo)
  -- ==========================================================
  for v_sig in select unnest(array['public.set_activity_interest(uuid,boolean)',
                                   'public.get_my_interests(uuid[])',
                                   'public.delete_my_account()']) loop
    v_oid := to_regprocedure(v_sig);
    perform pg_temp.chk('F0 ' || v_sig, 'função existe com a assinatura do contrato', v_oid is not null, coalesce(v_oid::text, 'ausente'));
    continue when v_oid is null;
    select p.*, pg_get_userbyid(p.proowner) as owner, pg_get_function_result(p.oid) as res
      into v_rec from pg_proc p where p.oid = v_oid;
    perform pg_temp.chk('F1 ' || v_sig, 'SECURITY DEFINER', v_rec.prosecdef, v_rec.prosecdef::text);
    perform pg_temp.chk('F2 ' || v_sig, 'proconfig fixa search_path vazio',
      coalesce(v_rec.proconfig && array['search_path=""', 'search_path='], false), coalesce(v_rec.proconfig::text, 'null'));
    perform pg_temp.chk('F3 ' || v_sig, 'dono = postgres', v_rec.owner = 'postgres', v_rec.owner);
    select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ',' order by 1)
      into v_list from aclexplode(v_rec.proacl) a where a.privilege_type = 'EXECUTE';
    perform pg_temp.chk('F4 ' || v_sig, 'ACL explícito (não default/PUBLIC)', v_rec.proacl is not null
      and not exists (select 1 from aclexplode(v_rec.proacl) a where a.grantee = 0), coalesce(v_rec.proacl::text, 'null (=PUBLIC EXECUTE)'));
    perform pg_temp.chk('F5 ' || v_sig, 'EXECUTE: anon NÃO', not has_function_privilege('anon', v_oid, 'EXECUTE'), v_list);
    perform pg_temp.chk('F6 ' || v_sig, 'EXECUTE: authenticated SIM', has_function_privilege('authenticated', v_oid, 'EXECUTE'), v_list);
    perform pg_temp.chk('F7 ' || v_sig, 'EXECUTE: só authenticated (+dono); service_role/outros não',
      coalesce(v_list, '') in ('authenticated,postgres', 'postgres,authenticated', 'authenticated'), v_list, 'WARN');
    -- heurística: nomes de relação não qualificados após FROM/JOIN/INTO/UPDATE/TABLE
    select string_agg(distinct m[2], ',') into v_list
      from regexp_matches(v_rec.prosrc, '\m(from|join|into|update|table)\s+([a-z_][a-z0-9_]*)\M(?!\s*\.)(?!\s*\()', 'gi') m
     where lower(m[2]) not in ('public', 'auth', 'pg_catalog', 'only', 'lateral', 'strict', 'select', 'set',
                               'of', 'skip', 'nowait', 'found', 'new', 'old')
       and lower(m[2]) !~ '^(v|p|l|r)_' ;
    perform pg_temp.chk('F8 ' || v_sig, 'heurística: sem nomes de relação não qualificados (falsos positivos possíveis: variáveis)',
      v_list is null, coalesce(v_list, ''), 'WARN');
    perform pg_temp.chk('F9 ' || v_sig, 'sem SQL dinâmico (EXECUTE/format)', v_rec.prosrc !~* '\mexecute\M', '', 'WARN');
    perform pg_temp.rec('F10 ' || v_sig, 'INFO', 'tipo de retorno / volatilidade',
      v_rec.res || ' / ' || v_rec.provolatile::text || ' / lang ' || (select lanname from pg_language where oid = v_rec.prolang));
  end loop;

  v_oid := to_regprocedure('public.set_activity_interest(uuid,boolean)');
  if v_oid is not null then
    select prosrc, pg_get_function_result(oid) as res into v_rec from pg_proc where oid = v_oid;
    perform pg_temp.chk('F11', 'set_activity_interest devolve TABLE(interested boolean, interested_count integer)',
      v_rec.res = 'TABLE(interested boolean, interested_count integer)', v_rec.res);
    perform pg_temp.chk('F12', 'set_activity_interest bloqueia a linha (FOR UPDATE)', v_rec.prosrc ~* 'for\s+update', '', 'WARN');
  end if;
  v_oid := to_regprocedure('public.get_my_interests(uuid[])');
  if v_oid is not null then
    select prosrc, pg_get_function_result(oid) as res into v_rec from pg_proc where oid = v_oid;
    perform pg_temp.chk('F13', 'get_my_interests devolve SETOF uuid', v_rec.res = 'SETOF uuid', v_rec.res);
    perform pg_temp.chk('F14', 'limite de ids usa cardinality() (array_length(...,1) é contornável com arrays 2D)',
      v_rec.prosrc ~* 'cardinality', substring(v_rec.prosrc from '(?i)(array_length[^;]*|cardinality[^;]*)'), 'WARN');
  end if;
  v_oid := to_regprocedure('public.delete_my_account()');
  if v_oid is not null then
    select prosrc into v_rec from pg_proc where oid = v_oid;
    perform pg_temp.chk('F15', 'delete_my_account usa auth.sessions (v1.1 #1)', v_rec.prosrc ~* 'auth\.sessions', '');
    perform pg_temp.chk('F16', 'delete_my_account NÃO usa iat (v1.1 #1)', v_rec.prosrc !~* '''iat''', '');
    perform pg_temp.chk('F17', 'role lida de auth.users.raw_app_meta_data (v1.1 #2)', v_rec.prosrc ~* 'raw_app_meta_data', '');
    perform pg_temp.chk('F18', 'role NÃO lida do JWT (app_metadata)', v_rec.prosrc !~* 'jwt\(\)\s*->+\s*''app_metadata''', '', 'WARN');
    perform pg_temp.chk('F19', 'e-mail das sugestões NÃO vem do JWT (v1.1 #3)', v_rec.prosrc !~* 'jwt\(\)\s*->>?\s*''email''', '');
    perform pg_temp.chk('F20', 'comparação de e-mail sem LIKE/ILIKE', v_rec.prosrc !~* '\m(i?like|similar)\M', '');
  end if;

  -- privilégios de tabela/vista
  perform pg_temp.chk('F21', 'policy compat_interested_count_update removida',
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities'
                and policyname = 'compat_interested_count_update'), '');
  for v_rec in select r_ from unnest(array['anon', 'authenticated']) r_ loop
    -- Decisão Level 2 (Lote 2, achado 2): UPDATE revogado só de anon; authenticated mantém-no
    -- (admin via policy admin_role_all; sem a policy compat, utilizadores comuns ficam com 0 linhas).
    perform pg_temp.chk('F22 ' || v_rec.r_, 'activities: anon sem UPDATE; authenticated mantém UPDATE (só admin passa no RLS)',
      v_rec.r_ = 'authenticated' or not has_table_privilege(v_rec.r_, 'public.activities', 'UPDATE')
      and not has_any_column_privilege(v_rec.r_, 'public.activities', 'UPDATE'), '');
    perform pg_temp.chk('F23 ' || v_rec.r_, 'activities: SELECT mantém-se', has_table_privilege(v_rec.r_, 'public.activities', 'SELECT'), '');
    perform pg_temp.chk('F24 ' || v_rec.r_, 'activities: sem INSERT/DELETE/TRUNCATE (RLS bloqueia INSERT, mas o GRANT é superfície)',
      not has_table_privilege(v_rec.r_, 'public.activities', 'INSERT,DELETE,TRUNCATE'),
      (select string_agg(p, ',') from unnest(array['INSERT','DELETE','TRUNCATE']) p
        where has_table_privilege(v_rec.r_, 'public.activities', p)), 'WARN');
    perform pg_temp.chk('F25 ' || v_rec.r_, 'active_activities: só SELECT',
      has_table_privilege(v_rec.r_, 'public.active_activities', 'SELECT')
      and not has_table_privilege(v_rec.r_, 'public.active_activities', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      and not has_any_column_privilege(v_rec.r_, 'public.active_activities', 'INSERT,UPDATE'),
      (select string_agg(p, ',') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
        where has_table_privilege(v_rec.r_, 'public.active_activities', p)));
    perform pg_temp.chk('F26 ' || v_rec.r_, 'activity_interests: nenhum privilégio (incl. TRUNCATE/REFERENCES/TRIGGER/MAINTAIN do default ACL)',
      not has_table_privilege(v_rec.r_, 'public.activity_interests', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      and not has_any_column_privilege(v_rec.r_, 'public.activity_interests', 'SELECT,INSERT,UPDATE,REFERENCES'),
      (select string_agg(p, ',') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
        where has_table_privilege(v_rec.r_, 'public.activity_interests', p)));
    v_oid := to_regprocedure('public.increment_activity_interest(uuid,smallint)');
    perform pg_temp.chk('F27 ' || v_rec.r_, 'increment_activity_interest sem EXECUTE',
      v_oid is null or not has_function_privilege(v_rec.r_, v_oid, 'EXECUTE'), coalesce(v_oid::text, 'removida'));
    perform pg_temp.chk('F28 ' || v_rec.r_, 'sem CREATE no schema public', not has_schema_privilege(v_rec.r_, 'public', 'CREATE'), '');
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ') into v_list from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform pg_temp.chk('F29', 'nenhuma função SECURITY DEFINER de public executável por anon', v_list is null, coalesce(v_list, ''), 'WARN');
  select string_agg(p.oid::regprocedure::text, ', ') into v_list from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  perform pg_temp.rec('F30', 'INFO', 'funções SECURITY DEFINER de public executáveis por authenticated', coalesce(v_list, '(nenhuma)'));
  perform pg_temp.rec('F31', 'INFO', 'TEMP na base para anon/authenticated (pg_temp é pesquisado 1º para relações não qualificadas)',
    'anon=' || has_database_privilege('anon', current_database(), 'TEMP') || ' authenticated=' || has_database_privilege('authenticated', current_database(), 'TEMP'));

  -- ==========================================================
  -- A. Sem sessão / anon
  -- ==========================================================
  perform pg_temp.expect('A1', 'anon: set_activity_interest negado', 'anon', '{"role":"anon"}',
    format('select * from public.set_activity_interest(%L, true)', a1), '42501');
  perform pg_temp.expect('A2', 'anon: get_my_interests negado', 'anon', '{"role":"anon"}',
    format('select * from public.get_my_interests(array[%L]::uuid[])', a1), '42501');
  perform pg_temp.expect('A3', 'anon: delete_my_account negado', 'anon', '{"role":"anon"}',
    'select public.delete_my_account()', '42501');
  perform pg_temp.expect('A4', 'anon sem claims: set_activity_interest negado', 'anon', null,
    format('select * from public.set_activity_interest(%L, true)', a1), '42501');
  perform pg_temp.expect('A5', 'anon com sub forjado (papel BD anon): set negado', 'anon', jsonb_build_object('role','anon','sub',uB),
    format('select * from public.set_activity_interest(%L, true)', a1), '42501');
  perform pg_temp.expect('A6', 'anon com sub+sessão forjados: delete negado', 'anon',
    jsonb_build_object('role','anon','sub',uB,'session_id',sB), 'select public.delete_my_account()', '42501');
  perform pg_temp.expect('A7', 'authenticated sem sub: set → 42501 not_authenticated', 'authenticated', '{"role":"authenticated"}',
    format('select * from public.set_activity_interest(%L, true)', a1), '42501', 'not_authenticated');
  perform pg_temp.expect('A8', 'authenticated sem sub: get_my_interests → 42501 not_authenticated', 'authenticated', '{"role":"authenticated"}',
    format('select * from public.get_my_interests(array[%L]::uuid[])', a1), '42501', 'not_authenticated');
  perform pg_temp.expect('A9', 'authenticated sem sub: delete → 42501 not_authenticated', 'authenticated', '{"role":"authenticated"}',
    'select public.delete_my_account()', '42501', 'not_authenticated');
  perform pg_temp.expect('A10', 'authenticated, sub vazio "": set negado (sem crash 22P02)', 'authenticated', '{"role":"authenticated","sub":""}',
    format('select * from public.set_activity_interest(%L, true)', a1), '42501', null, 'WARN');
  perform pg_temp.chk('A11', 'nenhuma alteração após A*', pg_temp.cnt(a1) = 0
    and (select count(*) from public.activity_interests where activity_id = a1 and user_id is not null) = 0,
    'a1=' || pg_temp.cnt(a1));
  perform pg_temp.chk('A12', 'auth.users intacto após A*', (select count(*) from auth.users where id in (uA,uB,uC,uD,uE,uG,uH)) = 7, '');

  -- ==========================================================
  -- B. Interesses: só auth.uid(); entradas hostis
  -- ==========================================================
  perform pg_temp.expect('B1', 'uA marca a1 → (t,1)', 'authenticated', pg_temp.cl(uA),
    format('select * from public.set_activity_interest(%L, true)', a1), 'OK');
  r := pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.set_activity_interest(%L, true)', a1));
  perform pg_temp.chk('B2', 'repetir true é idempotente (contador +1 uma só vez)', r = 'OK:(t,1)' and pg_temp.cnt(a1) = 1 and pg_temp.rows_(a1, uA) = 1, r || ' cnt=' || pg_temp.cnt(a1));
  perform pg_temp.chk('B3', 'linha criada pertence a auth.uid() e sem device_id',
    exists (select 1 from public.activity_interests where activity_id = a1 and user_id = uA and device_id is null), '');
  r := pg_temp.q('authenticated', pg_temp.cl(uB), format('select * from public.set_activity_interest(%L, true)', a1));
  perform pg_temp.chk('B4', 'uB marca a1 → (t,2)', r = 'OK:(t,2)' and pg_temp.cnt(a1) = 2, r);
  -- tentar actuar "em nome de outro": sub de uB mas claim user_id/uid extra de uA (ignorado)
  r := pg_temp.q('authenticated', pg_temp.cl(uB, null, jsonb_build_object('user_id', uA, 'uid', uA)),
    format('select * from public.set_activity_interest(%L, true)', a2));
  perform pg_temp.chk('B5', 'claims extra user_id/uid ignorados: interesse fica em uB',
    pg_temp.rows_(a2, uB) = 1 and pg_temp.rows_(a2, uA) = 0, r);
  r := pg_temp.q('authenticated', pg_temp.cl(uB), format('select * from public.set_activity_interest(%L, false)', a2));
  -- isolamento de leitura
  r := pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.get_my_interests(array[%L,%L,%L]::uuid[])', a1, a2, a5));
  perform pg_temp.chk('B6', 'get_my_interests(uA) só devolve linhas de uA', r = 'OK:(' || a1 || ');(' || a5 || ')', r);
  r := pg_temp.q('authenticated', pg_temp.cl(uC), format('select * from public.get_my_interests(array[%L,%L]::uuid[])', a1, a5));
  perform pg_temp.chk('B7', 'get_my_interests(uC sem interesses) vazio (não vê uA/uB nem device)', r = 'OK:', r);
  -- entradas hostis
  perform pg_temp.expect('B8', 'activity_id NULL → erro (P0002/22004/22023), sem efeito', 'authenticated', pg_temp.cl(uC),
    'select * from public.set_activity_interest(null, true)', 'P0002|22004|22023');
  perform pg_temp.expect('B9', 'activity inexistente → P0002 activity_not_found', 'authenticated', pg_temp.cl(uC),
    format('select * from public.set_activity_interest(%L, true)', aNo), 'P0002', 'activity_not_found');
  perform pg_temp.expect('B10', 'activity inactiva → P0002 activity_not_found', 'authenticated', pg_temp.cl(uC),
    format('select * from public.set_activity_interest(%L, true)', aIn), 'P0002', 'activity_not_found');
  perform pg_temp.chk('B11', 'nada inserido para aNo/aIn; contador aIn intacto',
    (select count(*) from public.activity_interests where activity_id in (aNo, aIn)) = 0 and pg_temp.cnt(aIn) = 0, '');
  -- p_interested NULL não deve ser tratado como false/true em silêncio
  r := pg_temp.expect('B12', 'p_interested NULL → erro (22004/22023), não apaga/insere', 'authenticated', pg_temp.cl(uA),
    format('select * from public.set_activity_interest(%L, null)', a1), '22004|22023|P0001', null, 'WARN');
  perform pg_temp.chk('B12b', 'p_interested NULL: interesse de uA em a1 e contador inalterados',
    pg_temp.rows_(a1, uA) = 1 and pg_temp.cnt(a1) = 2, 'rows=' || pg_temp.rows_(a1, uA) || ' cnt=' || pg_temp.cnt(a1));
  -- limites de get_my_interests
  select '{' || string_agg(gen_random_uuid()::text, ',') || '}' into v_lit from generate_series(1, 500);
  perform pg_temp.expect('B13', '500 ids aceites', 'authenticated', pg_temp.cl(uA),
    format('select * from public.get_my_interests(%L::uuid[])', v_lit), 'OK');
  select '{' || string_agg(gen_random_uuid()::text, ',') || '}' into v_lit from generate_series(1, 501);
  perform pg_temp.expect('B14', '501 ids → 22023 too_many_ids', 'authenticated', pg_temp.cl(uA),
    format('select * from public.get_my_interests(%L::uuid[])', v_lit), '22023', 'too_many_ids');
  select '{' || string_agg(gen_random_uuid()::text, ',') || '}' into v_lit from generate_series(1, 20000);
  perform pg_temp.expect('B15', '20000 ids → 22023', 'authenticated', pg_temp.cl(uA),
    format('select * from public.get_my_interests(%L::uuid[])', v_lit), '22023');
  select '{' || string_agg(a1::text, ',') || '}' into v_lit from generate_series(1, 501);
  perform pg_temp.expect('B16', '501 ids repetidos → 22023 (conta elementos, não distintos)', 'authenticated', pg_temp.cl(uA),
    format('select * from public.get_my_interests(%L::uuid[])', v_lit), '22023', null, 'WARN');
  select '{{' || string_agg(gen_random_uuid()::text, ',') || '},{' || string_agg(gen_random_uuid()::text, ',') || '}}'
    into v_lit from generate_series(1, 251);
  perform pg_temp.expect('B17', 'array 2D 2x251 (=502) → 22023 (sem contorno via array_length(...,1))', 'authenticated', pg_temp.cl(uA),
    format('select * from public.get_my_interests(%L::uuid[])', v_lit), '22023');
  r := pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.get_my_interests(array[%L,%L,null]::uuid[])', a1, a1));
  perform pg_temp.chk('B18', 'ids duplicados + NULL: devolve a1 uma vez, sem erro', r = 'OK:(' || a1 || ')', r, 'WARN');
  r := pg_temp.q('authenticated', pg_temp.cl(uA), 'select * from public.get_my_interests(null)');
  perform pg_temp.chk('B19', 'get_my_interests(NULL): vazio ou 22023/22004 (sem fuga)', r in ('OK:') or r ~ '^ERR:(22023|22004):', r, 'WARN');
  r := pg_temp.q('authenticated', pg_temp.cl(uA), 'select * from public.get_my_interests(array[]::uuid[])');
  perform pg_temp.chk('B20', 'get_my_interests(array vazio): vazio', r = 'OK:', r, 'WARN');

  -- ==========================================================
  -- C. Abuso do contador
  -- ==========================================================
  mn := 1000; mx := -1000;
  for i in 1..50 loop
    r := pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.set_activity_interest(%L, %L)', a2, (i % 2 = 1)));
    if r !~ '^OK:' then exit; end if;
    mn := least(mn, pg_temp.cnt(a2)); mx := greatest(mx, pg_temp.cnt(a2));
  end loop;
  perform pg_temp.chk('C1', '50 alternâncias true/false → saldo 0, nunca <0 nem >1',
    r ~ '^OK:' and pg_temp.cnt(a2) = 0 and mn >= 0 and mx <= 1 and pg_temp.rows_(a2, uA) = 0,
    'ultimo=' || r || ' cnt=' || pg_temp.cnt(a2) || ' min=' || mn || ' max=' || mx);
  for i in 1..20 loop
    r := pg_temp.q('authenticated', pg_temp.cl(uB), format('select * from public.set_activity_interest(%L, true)', a3));
  end loop;
  perform pg_temp.chk('C2', '20x true pelo mesmo utilizador → +1 só', pg_temp.cnt(a3) = 1 and pg_temp.rows_(a3, uB) = 1, r);
  r := pg_temp.q('authenticated', pg_temp.cl(uC), format('select * from public.set_activity_interest(%L, false)', a2));
  perform pg_temp.chk('C3', 'false sem interesse prévio, contador 0 → fica 0 (nunca -1)', r = 'OK:(f,0)' and pg_temp.cnt(a2) = 0, r);
  r := pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.set_activity_interest(%L, false)', a5));
  perform pg_temp.chk('C4', 'deriva: contador 0 com linha legada; false → linha apagada, contador 0 (não -1)',
    r ~ '^OK:' and pg_temp.cnt(a5) = 0 and pg_temp.rows_(a5, uA) = 0, r || ' cnt=' || coalesce(pg_temp.cnt(a5)::text, 'null'));
  r := pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.set_activity_interest(%L, true)', a4));
  perform pg_temp.chk('C5', 'contador NULL legado: true → 1', r = 'OK:(t,1)' and pg_temp.cnt(a4) = 1, r);
  r := pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.set_activity_interest(%L, false)', a4));
  perform pg_temp.chk('C6', 'contador NULL legado: false → 0', r = 'OK:(f,0)' and pg_temp.cnt(a4) = 0, r);
  -- a linha anónima legada (device_id) não é tocada por ninguém
  perform pg_temp.chk('C7', 'linha legada device_id em a1 intacta',
    exists (select 1 from public.activity_interests where activity_id = a1 and device_id = 'dev-legacy'), '');

  -- escrita directa no contador
  perform pg_temp.expect('C8', 'anon UPDATE activities.interested_count negado', 'anon', '{"role":"anon"}',
    format('update public.activities set interested_count = interested_count + 1 where id = %L', a1), '42501');
  r := pg_temp.expect('C9', 'authenticated comum: UPDATE de interested_count filtrado pelo RLS (0 linhas; contador verificado em C19)', 'authenticated', pg_temp.cl(uA),
    format('update public.activities set interested_count = interested_count + 1 where id = %L', a1), 'OK');
  perform pg_temp.chk('C9b', 'C9: número de linhas afectadas = 0', r = 'OK:rows=0', r);
  r := pg_temp.expect('C10', 'authenticated com JWT app_metadata.role=admin: UPDATE permitido (policy admin_role_all; sem alterar o contador)',
    'authenticated', pg_temp.cl(uB, null, '{"app_metadata":{"role":"admin"}}'),
    format('update public.activities set interested_count = interested_count where id = %L', a1), 'OK');
  perform pg_temp.chk('C10b', 'C10: número de linhas afectadas = 1', r = 'OK:rows=1', r);
  perform pg_temp.expect('C11', 'anon UPDATE via active_activities negado', 'anon', '{"role":"anon"}',
    format('update public.active_activities set interested_count = 999 where id = %L', a1), '42501');
  perform pg_temp.expect('C12', 'authenticated UPDATE via active_activities negado', 'authenticated', pg_temp.cl(uA),
    format('update public.active_activities set interested_count = 999 where id = %L', a1), '42501');
  perform pg_temp.expect('C13', 'anon INSERT via active_activities negado', 'anon', '{"role":"anon"}',
    'insert into public.active_activities(title, start_date, recurrence_type) values (''x'', now() + interval ''1 day'', ''none'')', '42501');
  perform pg_temp.expect('C14', 'authenticated INSERT via active_activities negado', 'authenticated', pg_temp.cl(uA),
    'insert into public.active_activities(title, start_date, recurrence_type) values (''x'', now() + interval ''1 day'', ''none'')', '42501');
  perform pg_temp.expect('C15', 'anon DELETE via active_activities negado', 'anon', '{"role":"anon"}',
    format('delete from public.active_activities where id = %L', a1), '42501');
  perform pg_temp.expect('C16', 'authenticated DELETE via active_activities negado', 'authenticated', pg_temp.cl(uA),
    format('delete from public.active_activities where id = %L', a1), '42501');
  perform pg_temp.expect('C17', 'anon increment_activity_interest negado', 'anon', '{"role":"anon"}',
    format('select public.increment_activity_interest(%L, 1::smallint)', a1), '42501|42883');
  perform pg_temp.expect('C18', 'authenticated increment_activity_interest negado', 'authenticated', pg_temp.cl(uA),
    format('select public.increment_activity_interest(%L, 1::smallint)', a1), '42501|42883');
  perform pg_temp.chk('C19', 'contador a1 inalterado após C8..C18', pg_temp.cnt(a1) = 2, 'a1=' || pg_temp.cnt(a1));
  r := pg_temp.q('anon', '{"role":"anon"}', format('select id, interested_count from public.active_activities where id = %L', a1));
  perform pg_temp.chk('C20', 'anon SELECT active_activities funciona (contador visível)', r = 'OK:(' || a1 || ',2)', r);
  r := pg_temp.q('authenticated', pg_temp.cl(uA), format('select id, interested_count from public.activities where id = %L', a1));
  perform pg_temp.chk('C21', 'authenticated SELECT activities funciona', r = 'OK:(' || a1 || ',2)', r);
  perform pg_temp.expect('C22', 'authenticated INSERT directo em activity_interests negado', 'authenticated', pg_temp.cl(uC),
    format('insert into public.activity_interests(activity_id, user_id) values (%L, %L)', a3, uC), '42501');
  perform pg_temp.expect('C23', 'anon INSERT directo (device_id) em activity_interests negado', 'anon', '{"role":"anon"}',
    format('insert into public.activity_interests(activity_id, device_id) values (%L, %L)', a3, 'dev-x'), '42501');
  perform pg_temp.expect('C24', 'authenticated DELETE directo em activity_interests negado', 'authenticated', pg_temp.cl(uB),
    format('delete from public.activity_interests where user_id = %L', uB), '42501');

  -- ==========================================================
  -- D. Exposição de identificadores
  -- ==========================================================
  perform pg_temp.expect('D1', 'anon SELECT user_id de activity_interests negado', 'anon', '{"role":"anon"}',
    'select user_id from public.activity_interests', '42501');
  perform pg_temp.expect('D2', 'anon SELECT device_id negado', 'anon', '{"role":"anon"}',
    'select device_id from public.activity_interests', '42501');
  perform pg_temp.expect('D3', 'authenticated SELECT * negado', 'authenticated', pg_temp.cl(uA),
    'select * from public.activity_interests', '42501');
  perform pg_temp.expect('D4', 'authenticated SELECT count(*) negado', 'authenticated', pg_temp.cl(uA),
    'select count(*) from public.activity_interests', '42501');
  perform pg_temp.expect('D5', 'anon SELECT public.users negado', 'anon', '{"role":"anon"}',
    'select id, email from public.users', '42501');
  perform pg_temp.expect('D6', 'authenticated SELECT auth.sessions negado', 'authenticated', pg_temp.cl(uA),
    'select id from auth.sessions', '42501');
  perform pg_temp.expect('D7', 'authenticated SELECT auth.users negado', 'authenticated', pg_temp.cl(uA),
    'select id from auth.users', '42501');

  -- ==========================================================
  -- G. Sequestro de search_path
  -- ==========================================================
  perform pg_temp.expect('G1', 'authenticated CREATE TABLE em public negado', 'authenticated', pg_temp.cl(uA),
    'create table public.activity_interests_shadow(x int)', '42501');
  perform pg_temp.expect('G2', 'authenticated CREATE FUNCTION public.uid() negado', 'authenticated', pg_temp.cl(uA),
    'create function public.uid() returns uuid language sql as $x$ select null::uuid $x$', '42501');
  perform pg_temp.expect('G3', 'anon CREATE VIEW em public negado', 'anon', '{"role":"anon"}',
    'create view public.activities_v as select 1 as x', '42501');
  perform pg_temp.expect('G4', 'authenticated CREATE SCHEMA negado', 'authenticated', pg_temp.cl(uA),
    'create schema zz_hijack', '42501');
  perform pg_temp.expect('G5', 'authenticated CREATE FUNCTION em auth negado', 'authenticated', pg_temp.cl(uA),
    'create function auth.zz() returns int language sql as $x$ select 1 $x$', '42501');
  -- G6: tabelas temporárias com os nomes usados pelas RPC (pg_temp é pesquisado 1º para
  -- relações não qualificadas, mesmo com search_path = ''). Só é explorável se a função
  -- usar nomes não qualificados. Tudo desfeito no fim (rollback da subtransacção).
  r := null; r2 := null;
  begin
    perform set_config('request.jwt.claims', pg_temp.cl(uB)::text, true);
    set local role authenticated;
    create temp table activity_interests (id uuid, activity_id uuid, user_id uuid, device_id text, created_at timestamptz);
    create temp table activities (id uuid, title text, interested_count int, start_date timestamptz, end_date timestamptz, recurrence_type text);
    create temp table active_activities (id uuid, title text, interested_count int);
    create temp table users (id uuid, email text, raw_app_meta_data jsonb);
    create temp table sessions (id uuid, user_id uuid, created_at timestamptz, not_after timestamptz);
    insert into pg_temp.activity_interests(activity_id, user_id) values (a4, uB), (a5, uB);
    insert into pg_temp.activities(id, title, interested_count) values (aNo, 'fake', 0);
    insert into pg_temp.active_activities(id, title, interested_count) values (aNo, 'fake', 0);
    begin
      select coalesce(string_agg(x::text, ',' order by x::text), '') into r from public.get_my_interests(array[a1, a4, a5]) x;
    exception when others then r := 'ERR:' || sqlstate || ':' || sqlerrm; end;
    begin
      select s::text into r2 from public.set_activity_interest(aNo, true) s;
      r2 := 'OK:' || r2;
    exception when others then r2 := 'ERR:' || sqlstate || ':' || sqlerrm; end;
    raise exception using errcode = 'P0001', message = 'g6_rollback';
  exception when others then
    if sqlerrm <> 'g6_rollback' then r := coalesce(r, 'SETUP:' || sqlstate || ':' || sqlerrm); end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if r like 'SETUP:42501%' then
    perform pg_temp.rec('G6', 'PASS', 'tabelas temporárias de sombra impossíveis (sem TEMP)', r);
  else
    perform pg_temp.chk('G6', 'get_my_interests ignora pg_temp.activity_interests de sombra', r = a1::text, coalesce(r, 'null'));
    perform pg_temp.chk('G7', 'set_activity_interest ignora pg_temp.activities/active_activities de sombra (aNo → P0002)',
      r2 like 'ERR:P0002:%', coalesce(r2, 'null'));
  end if;

  -- ==========================================================
  -- E. delete_my_account
  -- ==========================================================
  perform pg_temp.expect('E1', 'sem claim session_id → 28000', 'authenticated', pg_temp.cl(uD),
    'select public.delete_my_account()', '28000', 'reauthentication_required');
  perform pg_temp.expect('E2', 'session_id de OUTRO utilizador (fresca) → 28000', 'authenticated', pg_temp.cl(uD, sB::text),
    'select public.delete_my_account()', '28000', 'reauthentication_required');
  perform pg_temp.expect('E3', 'sessão criada há 10 min com refresh agora (refreshed_at/updated_at) → 28000', 'authenticated',
    pg_temp.cl(uD, sDold::text, jsonb_build_object('iat', extract(epoch from now())::bigint)),
    'select public.delete_my_account()', '28000', 'reauthentication_required');
  perform pg_temp.expect('E4', 'sessão criada há 6 min → 28000', 'authenticated', pg_temp.cl(uD, sD6::text),
    'select public.delete_my_account()', '28000', 'reauthentication_required');
  perform pg_temp.expect('E5', 'not_after no passado → 28000', 'authenticated', pg_temp.cl(uD, sDexp::text),
    'select public.delete_my_account()', '28000', 'reauthentication_required');
  delete from auth.sessions where id = sDrev;
  perform pg_temp.expect('E6', 'sessão apagada (revogada/logout) → 28000', 'authenticated', pg_temp.cl(uD, sDrev::text),
    'select public.delete_my_account()', '28000', 'reauthentication_required');
  perform pg_temp.expect('E7', 'session_id malformado → 28000 (não 22P02)', 'authenticated', pg_temp.cl(uD, 'nao-e-uuid'),
    'select public.delete_my_account()', '28000', null, 'WARN');
  perform pg_temp.expect('E8', 'session_id JSON null → 28000', 'authenticated', pg_temp.cl(uD, null, '{"session_id":null}'),
    'select public.delete_my_account()', '28000');
  perform pg_temp.expect('E9', 'session_id numérico/objecto → 28000 (sem crash)', 'authenticated', pg_temp.cl(uD, null, '{"session_id":{"id":1}}'),
    'select public.delete_my_account()', '28000', null, 'WARN');
  perform pg_temp.expect('E10', 'sub inexistente → P0002/28000', 'authenticated', pg_temp.cl(uX, gen_random_uuid()::text),
    'select public.delete_my_account()', 'P0002|28000');
  perform pg_temp.chk('E11', 'uD continua a existir após E1..E9', exists (select 1 from auth.users where id = uD), '');
  -- conta gerida
  perform pg_temp.expect('E12', 'conta gerida (raw_app_meta_data.role) com sessão fresca e JWT sem role → 42501 account_managed',
    'authenticated', pg_temp.cl(uC, sC::text), 'select public.delete_my_account()', '42501', 'account_managed');
  perform pg_temp.expect('E13', 'conta gerida com JWT app_metadata.role vazio → 42501', 'authenticated',
    pg_temp.cl(uC, sC::text, '{"app_metadata":{"role":null,"provider":"email"}}'), 'select public.delete_my_account()', '42501');
  perform pg_temp.chk('E14', 'uC continua a existir', exists (select 1 from auth.users where id = uC), '');
  -- JWT diz admin, BD não → não bloquear pelo JWT; sessão de 4 min (dentro do limite)
  v_cnt_a1 := pg_temp.cnt(a1);
  perform pg_temp.expect('E15', 'JWT app_metadata.role=admin mas BD sem role, sessão de 4 min → sucesso (BD autoritativa)',
    'authenticated', pg_temp.cl(uE, sE::text, '{"app_metadata":{"role":"admin"}}'), 'select public.delete_my_account()', 'OK');
  perform pg_temp.chk('E16', 'uE apagado', not exists (select 1 from auth.users where id = uE), '');
  -- sucesso uA
  r := pg_temp.q('authenticated', pg_temp.cl(uA, sA::text), format('select * from public.get_my_interests(array[%L]::uuid[])', a1));
  perform pg_temp.expect('E17', 'uA com sessão fresca → sucesso', 'authenticated', pg_temp.cl(uA, sA::text),
    'select public.delete_my_account()', 'OK');
  perform pg_temp.chk('E18', 'só uA apagado (uB, uC, uD, uG, uH existem)',
    not exists (select 1 from auth.users where id = uA)
    and (select count(*) from auth.users where id in (uB, uC, uD, uG, uH)) = 5, '');
  perform pg_temp.chk('E19', 'favoritos/interesses/sessões de uA removidos em cascata; os de uB intactos',
    not exists (select 1 from public.favorites where user_id = uA)
    and not exists (select 1 from public.activity_interests where user_id = uA)
    and not exists (select 1 from auth.sessions where user_id = uA)
    and exists (select 1 from public.favorites where user_id = uB)
    and pg_temp.rows_(a1, uB) = 1 and pg_temp.rows_(a3, uB) = 1, '');
  select * into v_rec from public.suggestions where id = gA1;
  perform pg_temp.chk('E20', 'sugestão de uA (e-mail em maiúsculas): email/phone/comment NULL; title/location mantidos',
    v_rec.email is null and v_rec.phone is null and v_rec.comment is null and v_rec.title = 'Sugestao A' and v_rec.location = 'Lisboa',
    row(v_rec.email, v_rec.phone, v_rec.comment, v_rec.title, v_rec.location)::text);
  perform pg_temp.chk('E21', 'armadilha LIKE: sugestão aX1@x.test intacta',
    (select email = 'aX1@x.test' and phone = '911000002' and comment = 'manter' from public.suggestions where id = gLike), '');
  perform pg_temp.chk('E22', 'sugestões de uB e anónimas intactas',
    (select count(*) from public.suggestions where id in (gB, gAnon) and phone is not null and comment = 'manter') = 2, '');
  perform pg_temp.chk('E23', 'contador histórico preservado (v1.1 #4) após exclusões', pg_temp.cnt(a1) = v_cnt_a1,
    'antes=' || v_cnt_a1 || ' depois=' || pg_temp.cnt(a1), 'WARN');
  perform pg_temp.chk('E24', 'linha legada device_id intacta após exclusão', exists (select 1 from public.activity_interests where device_id = 'dev-legacy'), '');
  perform pg_temp.expect('E25', 'repetir após exclusão → P0002/28000', 'authenticated', pg_temp.cl(uA, sA::text),
    'select public.delete_my_account()', 'P0002|28000');
  -- e-mail NULL: não pode anonimizar sugestões anónimas (email NULL)
  perform pg_temp.expect('E26', 'uG (e-mail NULL) → sucesso', 'authenticated', pg_temp.cl(uG, sG::text),
    'select public.delete_my_account()', 'OK');
  perform pg_temp.chk('E27', 'uG: sugestões anónimas (email NULL) NÃO anonimizadas',
    (select phone = '911000004' and comment = 'manter' from public.suggestions where id = gAnon), '');
  -- JWT com e-mail de outra pessoa: a anonimização usa auth.users.email
  perform pg_temp.expect('E28', 'uH com JWT email=b@x.test → sucesso', 'authenticated', pg_temp.cl(uH, sH::text, '{"email":"b@x.test"}'),
    'select public.delete_my_account()', 'OK');
  perform pg_temp.chk('E29', 'uH: sugestões de uB NÃO anonimizadas pelo e-mail do JWT',
    (select email = 'b@x.test' and phone = '911000003' and comment = 'manter' from public.suggestions where id = gB), '');
  perform pg_temp.chk('E30', 'uB intacto no fim', exists (select 1 from auth.users where id = uB), '');

  -- ==========================================================
  -- Z. Destrutivos (no fim): TRUNCATE
  -- ==========================================================
  perform pg_temp.expect('Z1', 'anon TRUNCATE activity_interests negado', 'anon', '{"role":"anon"}', 'truncate public.activity_interests', '42501');
  perform pg_temp.expect('Z2', 'authenticated TRUNCATE activity_interests negado', 'authenticated', pg_temp.cl(uB), 'truncate public.activity_interests', '42501');
  perform pg_temp.expect('Z3', 'authenticated TRUNCATE activities negado', 'authenticated', pg_temp.cl(uB), 'truncate public.activities cascade', '42501');
  perform pg_temp.expect('Z4', 'anon TRUNCATE suggestions negado (fora do âmbito; informativo)', 'anon', '{"role":"anon"}', 'truncate public.suggestions', '42501', null, 'WARN');

  -- ==========================================================
  -- Relatório
  -- ==========================================================
  for v_rec in select * from t_res order by seq loop
    raise notice '% | % | % | %', rpad(v_rec.status, 4), rpad(v_rec.id, greatest(8, length(v_rec.id))), v_rec.descr,
      case when v_rec.status = 'PASS' then '' else 'evid: ' || v_rec.evidence end;
  end loop;
  select count(*) filter (where status = 'PASS'), count(*) filter (where status = 'FAIL')
    into n, n2 from t_res;
  raise notice 'LOTE2-ABUSE TOTAL: PASS=% FAIL=% WARN=% INFO=%', n, n2,
    (select count(*) from t_res where status = 'WARN'), (select count(*) from t_res where status = 'INFO');
  if n2 > 0 then
    raise exception 'LOTE2-ABUSE: % caso(s) FAIL', n2;
  end if;
end
$main$;

rollback;
