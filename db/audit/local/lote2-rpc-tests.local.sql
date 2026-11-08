-- ============================================================
-- Testes SÓ LOCAIS das RPC do Lote 2 (0024 interesses, 0025 exclusão
-- de conta) e do fecho da escrita directa. REF: Lote 2, contrato v1.1.
--
-- Recusa correr fora da simulação local (vivere.sim = 'local', definido
-- por supabase-sim.sql). Pré-requisito: base criada com supabase-sim.sql
-- e a cadeia 0000..0025 aplicada. Correr como superutilizador local
-- (cria fixtures em auth.users/auth.sessions):
--   psql -U supabase_admin -d <base> -v ON_ERROR_STOP=1 -f lote2-rpc-tests.local.sql
--
-- Cada caso corre com SET LOCAL ROLE anon/authenticated e
-- request.jwt.claims (o mesmo mecanismo do PostgREST). Cada linha do
-- relatório (NOTICE) = id | papel | esperado | obtido | PASS/FAIL.
-- Tudo corre numa transacção que termina em ROLLBACK: nada persiste.
-- Se houver algum FAIL, o bloco termina com EXCEPTION (psql sai com
-- código != 0).
--
-- Concorrência (dois processos): lote2-concurrency.local.sh.
-- ============================================================

begin;

do $main$
declare
  v_a   uuid := '00000000-0000-4000-8000-0000000002a1';  -- utilizador A
  v_b   uuid := '00000000-0000-4000-8000-0000000002b1';  -- utilizador B
  v_m   uuid := '00000000-0000-4000-8000-0000000002c1';  -- conta gerida (role)
  v_d   uuid := '00000000-0000-4000-8000-0000000002d1';  -- conta a apagar
  v_ghost uuid := '00000000-0000-4000-8000-0000000002e1'; -- sub sem auth.users
  v_u   uuid := '00000000-0000-4000-8000-0000000002f1';  -- e-mail NÃO confirmado
  s_u_fresh   uuid := '10000000-0000-4000-8000-0000000002f1';
  s_d_fresh2  uuid := '10000000-0000-4000-8000-0000000002d4';
  s_d_fresh   uuid := '10000000-0000-4000-8000-0000000002d1';
  s_d_old     uuid := '10000000-0000-4000-8000-0000000002d2';
  s_d_expired uuid := '10000000-0000-4000-8000-0000000002d3';
  s_b_fresh   uuid := '10000000-0000-4000-8000-0000000002b1';
  s_m_fresh   uuid := '10000000-0000-4000-8000-0000000002c1';
  s_g_fresh   uuid := '10000000-0000-4000-8000-0000000002e1';
  v_ven uuid; v_act uuid; v_act0 uuid; v_actnull uuid; v_old uuid;
  v_missing uuid := '20000000-0000-4000-8000-000000000404';
  v_ids500 text; v_ids501 text;
  v_report text; v_fail int; v_total int;
  ca jsonb; cb jsonb; cd jsonb;
begin
  if coalesce(current_setting('vivere.sim', true), '') <> 'local' then
    raise exception 'Recusado: script só para a simulação local (vivere.sim).';
  end if;
  if pg_catalog.to_regprocedure('public.delete_my_account()') is null then
    raise exception 'Pré-requisito: aplicar 0000..0025 antes destes testes.';
  end if;

  create temp table t_results (seq serial, id text, papel text, esperado text, obtido text, ok boolean, msg text);

  -- Caso SQL executado com um papel e claims. p_query: envolve num
  -- SELECT count/string_agg para devolver o valor (val=...).
  create function pg_temp.t(p_id text, p_role text, p_claims jsonb, p_sql text, p_expect text, p_query boolean default true)
  returns void language plpgsql as $f$
  declare n bigint := 0; st text := 'OK'; m text := ''; v text; got text; pass boolean;
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims, jsonb_build_object('role', p_role))::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);
    execute format('set local role %I', p_role);
    begin
      if p_query then
        execute format('select count(*), string_agg(x::text, %L order by x::text) from (%s) x', ',', p_sql) into n, v;
      else
        execute p_sql;
        get diagnostics n = row_count;
      end if;
    exception when others then
      st := sqlstate; m := sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);

    got := case when st = 'OK' then 'rows=' || n
                when st = '42501' and m ilike 'permission denied%' then 'deny_grant'
                when st = '42501' and m ilike '%row-level security%' then 'deny_rls'
                else st || ' ' || m end;
    pass := case when p_expect like 'val=%' then st = 'OK' and p_expect = 'val=' || coalesce(v, '')
                 else got = p_expect end;
    if p_expect like 'val=%' and st = 'OK' then got := 'val=' || coalesce(v, ''); end if;
    insert into t_results(id, papel, esperado, obtido, ok, msg) values (p_id, p_role, p_expect, got, pass, left(m, 140));
  end;
  $f$;

  -- Verificação feita como dono (estado depois dos casos)
  create function pg_temp.chk(p_id text, p_desc text, p_got text, p_expect text)
  returns void language plpgsql as $f$
  begin
    insert into t_results(id, papel, esperado, obtido, ok, msg)
      values (p_id, '(dono)', p_expect, coalesce(p_got, '<null>'), coalesce(p_got, '<null>') = p_expect, p_desc);
  end;
  $f$;

  -- ---------- fixtures (desfeitas pelo ROLLBACK final) ----------
  insert into auth.users(id, email, raw_app_meta_data, email_confirmed_at) values
    (v_a, 'a.lote2@example.invalid', '{"provider":"email"}', now()),
    (v_b, 'b.lote2@example.invalid', '{"provider":"email"}', now()),
    (v_m, 'm.lote2@example.invalid', '{"provider":"email","role":"reviewer"}', now()),
    (v_d, 'D.Lote2@Example.invalid', '{"provider":"email"}', now()),
    (v_u, 'b.lote2@example.invalid.unconfirmed', '{"provider":"email"}', null);
  insert into auth.sessions(id, user_id, created_at, updated_at, refreshed_at, not_after) values
    (s_d_fresh,   v_d, now() - interval '1 minute',  now(), null, null),
    (s_d_old,     v_d, now() - interval '10 minutes', now(), now()::timestamp, null),
    (s_d_expired, v_d, now() - interval '1 minute',  now(), null, now() - interval '1 second'),
    (s_b_fresh,   v_b, now() - interval '1 minute',  now(), null, null),
    (s_m_fresh,   v_m, now() - interval '1 minute',  now(), null, null),
    (s_u_fresh,   v_u, now() - interval '1 minute',  now(), null, null),
    (s_d_fresh2,  v_d, now() - interval '1 minute',  now(), null, null);
  insert into auth.identities(provider_id, user_id, provider) values (v_d::text, v_d, 'email');
  insert into auth.refresh_tokens(token, user_id, revoked, session_id) values ('tok-lote2', v_d::text, false, s_d_fresh);

  insert into public.venues(name) values ('Lote2 fixture venue') returning id into v_ven;
  insert into public.activities(title, venue_id, start_date, recurrence_type, interested_count)
    values ('Lote2 activa', v_ven, now() + interval '7 days', 'none', 5) returning id into v_act;
  insert into public.activities(title, venue_id, start_date, recurrence_type, interested_count)
    values ('Lote2 activa zero', v_ven, now() + interval '7 days', 'none', 0) returning id into v_act0;
  insert into public.activities(title, venue_id, start_date, recurrence_type, interested_count)
    values ('Lote2 activa null', v_ven, now() + interval '7 days', 'none', null) returning id into v_actnull;
  insert into public.activities(title, venue_id, start_date, end_date, recurrence_type, interested_count)
    values ('Lote2 inactiva', v_ven, now() - interval '30 days', now() - interval '20 days', 'none', 3) returning id into v_old;
  insert into public.favorites(user_id, activity_id) values (v_d, v_act), (v_b, v_act);
  insert into public.suggestions(title, location, phone, email, comment, language) values
    ('Sugestao D 1', 'Lisboa', '+351900000001', 'd.lote2@example.invalid', 'comentario D', 'pt'),
    ('Sugestao D 2', 'Porto', '+351900000002', 'D.LOTE2@EXAMPLE.INVALID', null, 'en'),
    ('Sugestao B',   'Braga', '+351900000003', 'b.lote2@example.invalid', 'comentario B', 'pt'),
    ('Sugestao anonima', 'Faro', '+351900000004', null, 'sem email', 'pt'),
    ('Sugestao U', 'Evora', '+351900000005', 'b.lote2@example.invalid.unconfirmed', 'nao confirmado', 'pt');

  ca := jsonb_build_object('role', 'authenticated', 'aud', 'authenticated', 'sub', v_a, 'aal', 'aal1', 'amr', jsonb_build_array(jsonb_build_object('method', 'password')));
  cb := jsonb_build_object('role', 'authenticated', 'aud', 'authenticated', 'sub', v_b, 'session_id', s_b_fresh, 'aal', 'aal1');
  cd := jsonb_build_object('role', 'authenticated', 'aud', 'authenticated', 'sub', v_d, 'aal', 'aal1');

  -- ---------- EXECUTE: anon negado; função antiga fechada ----------
  perform pg_temp.t('X-01', 'anon', null, format('select * from public.set_activity_interest(%L, true)', v_act), 'deny_grant');
  perform pg_temp.t('X-02', 'anon', null, format('select * from public.get_my_interests(array[%L]::uuid[])', v_act), 'deny_grant');
  perform pg_temp.t('X-03', 'anon', null, 'select public.delete_my_account()', 'deny_grant');
  perform pg_temp.t('X-04', 'anon', null, format('select public.increment_activity_interest(%L, 1::smallint)', v_act), 'deny_grant');
  perform pg_temp.t('X-05', 'authenticated', ca, format('select public.increment_activity_interest(%L, 1::smallint)', v_act), 'deny_grant');
  perform pg_temp.t('X-06', 'authenticated', jsonb_build_object('role', 'authenticated'),
    format('select * from public.set_activity_interest(%L, true)', v_act), '42501 not_authenticated');
  perform pg_temp.t('X-07', 'authenticated', jsonb_build_object('role', 'authenticated'),
    format('select * from public.get_my_interests(array[%L]::uuid[])', v_act), '42501 not_authenticated');

  perform pg_temp.t('X-08', 'authenticated', ca || '{"is_anonymous":true}'::jsonb,
    format('select * from public.set_activity_interest(%L, true)', v_act), '42501 not_authenticated');
  perform pg_temp.t('X-09', 'authenticated', ca || '{"is_anonymous":true}'::jsonb,
    format('select * from public.get_my_interests(array[%L]::uuid[])', v_act), '42501 not_authenticated');
  perform pg_temp.t('X-10', 'service_role', jsonb_build_object('role', 'service_role'),
    format('select * from public.set_activity_interest(%L, true)', v_act), 'deny_grant');
  perform pg_temp.t('X-11', 'service_role', jsonb_build_object('role', 'service_role'), 'select public.delete_my_account()', 'deny_grant');

  -- ---------- set_activity_interest ----------
  perform pg_temp.t('I-01', 'authenticated', ca, format('select * from public.set_activity_interest(%L, true)', v_act), 'val=(t,6)');
  perform pg_temp.t('I-02', 'authenticated', ca, format('select * from public.set_activity_interest(%L, true)', v_act), 'val=(t,6)');
  perform pg_temp.chk('I-03', 'true/true: +1 uma só vez, 1 linha de A',
    (select interested_count || '/' || (select count(*) from public.activity_interests where activity_id = v_act and user_id = v_a)
     from public.activities where id = v_act), '6/1');
  perform pg_temp.t('I-04', 'authenticated', cb, format('select * from public.set_activity_interest(%L, true)', v_act), 'val=(t,7)');
  perform pg_temp.t('I-05', 'authenticated', ca, format('select * from public.set_activity_interest(%L, false)', v_act), 'val=(f,6)');
  perform pg_temp.t('I-06', 'authenticated', ca, format('select * from public.set_activity_interest(%L, false)', v_act), 'val=(f,6)');
  perform pg_temp.chk('I-07', 'false/false: -1 uma só vez; linha de B intacta',
    (select interested_count || '/' || (select count(*) from public.activity_interests where activity_id = v_act and user_id = v_a)
            || '/' || (select count(*) from public.activity_interests where activity_id = v_act and user_id = v_b)
     from public.activities where id = v_act), '6/0/1');
  -- nunca negativo: contador histórico a 0 com linha existente
  perform pg_temp.t('I-08', 'authenticated', ca, format('select * from public.set_activity_interest(%L, true)', v_act0), 'val=(t,1)');
  update public.activities set interested_count = 0 where id = v_act0;   -- dono: simula histórico divergente (delta -1 aceite pelo guard)
  perform pg_temp.t('I-09', 'authenticated', ca, format('select * from public.set_activity_interest(%L, false)', v_act0), 'val=(f,0)');
  perform pg_temp.chk('I-10', 'nunca abaixo de 0; linha apagada',
    (select interested_count || '/' || (select count(*) from public.activity_interests where activity_id = v_act0)
     from public.activities where id = v_act0), '0/0');
  perform pg_temp.t('I-11', 'authenticated', ca, format('select * from public.set_activity_interest(%L, true)', v_actnull), 'val=(t,1)');
  perform pg_temp.t('I-12', 'authenticated', ca, format('select * from public.set_activity_interest(%L, true)', v_old), 'P0002 activity_not_found');
  -- desmarcar numa actividade inactiva é permitido (decisão do orquestrador, item 8)
  perform pg_temp.t('I-13', 'authenticated', ca, format('select * from public.set_activity_interest(%L, false)', v_old), 'val=(f,3)');
  insert into public.activity_interests(activity_id, user_id) values (v_old, v_a);   -- dono: interesse antigo de A
  perform pg_temp.t('I-13b', 'authenticated', ca, format('select * from public.set_activity_interest(%L, false)', v_old), 'val=(f,2)');
  perform pg_temp.t('I-13c', 'authenticated', ca, format('select * from public.set_activity_interest(%L, false)', v_old), 'val=(f,2)');
  perform pg_temp.t('I-14', 'authenticated', ca, format('select * from public.set_activity_interest(%L, true)', v_missing), 'P0002 activity_not_found');
  perform pg_temp.t('I-15', 'authenticated', ca, 'select * from public.set_activity_interest(null, true)', 'P0002 activity_not_found');
  perform pg_temp.t('I-16', 'authenticated', ca, format('select * from public.set_activity_interest(%L, null)', v_act), '22023 invalid_parameter');
  perform pg_temp.chk('I-17', 'inactiva: marcar negado; desmarcar -1 uma só vez',
    (select interested_count || '/' || (select count(*) from public.activity_interests where activity_id = v_old)
     from public.activities where id = v_old), '2/0');

  -- ---------- get_my_interests ----------
  perform pg_temp.t('G-01', 'authenticated', ca, format('select * from public.get_my_interests(array[%L,%L,%L,%L]::uuid[])', v_act, v_act0, v_actnull, v_old),
    'val=(' || v_actnull::text || ')');                                                      -- só as de A (B tem v_act)
  perform pg_temp.t('G-02', 'authenticated', cb, format('select * from public.get_my_interests(array[%L,%L]::uuid[])', v_act, v_actnull),
    'val=(' || v_act::text || ')');
  perform pg_temp.t('G-03', 'authenticated', ca, 'select * from public.get_my_interests(null)', 'rows=0');
  perform pg_temp.t('G-04', 'authenticated', ca, 'select * from public.get_my_interests(array[]::uuid[])', 'rows=0');
  select 'array[' || string_agg(quote_literal(gen_random_uuid()::text), ',') || ']::uuid[]' into v_ids500 from generate_series(1, 499);
  v_ids500 := replace(v_ids500, 'array[', format('array[%L,', v_actnull));
  select 'array[' || string_agg(quote_literal(gen_random_uuid()::text), ',') || ']::uuid[]' into v_ids501 from generate_series(1, 501);
  perform pg_temp.t('G-05', 'authenticated', ca, 'select * from public.get_my_interests(' || v_ids500 || ')', 'val=(' || v_actnull::text || ')');
  perform pg_temp.t('G-06', 'authenticated', ca, 'select * from public.get_my_interests(' || v_ids501 || ')', '22023 too_many_ids');

  -- ---------- acesso directo fechado ----------
  perform pg_temp.t('P-01', 'anon', null, format('update public.activities set interested_count = interested_count + 1 where id = %L', v_act), 'deny_grant', false);
  -- authenticated mantém UPDATE (admin); sem a política compat um utilizador comum não passa no RLS
  perform pg_temp.t('P-02', 'authenticated', ca, format('update public.activities set interested_count = interested_count + 1 where id = %L', v_act), 'rows=0', false);
  perform pg_temp.t('P-02b', 'authenticated', ca, format('update public.activities set title = ''x'' where id = %L', v_act), 'rows=0', false);
  perform pg_temp.t('P-02c', 'authenticated', ca || '{"app_metadata":{"role":"admin"}}'::jsonb,
    format('update public.activities set title = ''Lote2 activa (admin)'' where id = %L', v_act), 'rows=1', false);
  perform pg_temp.t('P-02d', 'anon', null, 'truncate public.activity_interests', 'deny_grant', false);
  perform pg_temp.t('P-02e', 'authenticated', ca, 'truncate public.activity_interests', 'deny_grant', false);
  perform pg_temp.t('P-03', 'anon', null, 'insert into public.active_activities(title) values (''Lote2 nunca'')', 'deny_grant', false);
  perform pg_temp.t('P-04', 'authenticated', ca, 'insert into public.active_activities(title) values (''Lote2 nunca'')', 'deny_grant', false);
  perform pg_temp.t('P-05', 'anon', null, format('update public.active_activities set interested_count = 99 where id = %L', v_act), 'deny_grant', false);
  perform pg_temp.t('P-06', 'authenticated', ca, format('update public.active_activities set interested_count = 99 where id = %L', v_act), 'deny_grant', false);
  perform pg_temp.t('P-07', 'anon', null, format('delete from public.active_activities where id = %L', v_act), 'deny_grant', false);
  perform pg_temp.t('P-08', 'authenticated', ca, format('delete from public.active_activities where id = %L', v_act), 'deny_grant', false);
  perform pg_temp.t('P-09', 'anon', null, 'select user_id from public.activity_interests', 'deny_grant');
  perform pg_temp.t('P-10', 'authenticated', ca, 'select user_id from public.activity_interests', 'deny_grant');
  perform pg_temp.t('P-11', 'authenticated', ca, format('insert into public.activity_interests(activity_id, user_id) values (%L, %L)', v_act, v_a), 'deny_grant', false);
  perform pg_temp.t('P-12', 'authenticated', ca, format('delete from public.activity_interests where user_id = %L', v_a), 'deny_grant', false);
  perform pg_temp.t('P-13', 'anon', null, format('select id from public.activities where id = %L', v_act), 'rows=1');
  perform pg_temp.t('P-14', 'authenticated', ca, format('select id from public.activities where id = %L', v_act), 'rows=1');
  perform pg_temp.t('P-15', 'anon', null, format('select interested_count from public.active_activities where id = %L', v_act), 'val=(6)');
  perform pg_temp.t('P-16', 'authenticated', ca, format('select interested_count from public.active_activities where id = %L', v_act), 'val=(6)');

  -- ---------- delete_my_account: recusas (nada pode ser apagado) ----------
  perform pg_temp.t('D-01', 'authenticated', jsonb_build_object('role', 'authenticated'), 'select public.delete_my_account()', '42501 not_authenticated');
  perform pg_temp.t('D-02', 'authenticated', cd, 'select public.delete_my_account()', '28000 reauthentication_required');                 -- sem session_id
  perform pg_temp.t('D-03', 'authenticated', cd || jsonb_build_object('session_id', s_d_old), 'select public.delete_my_account()', '28000 reauthentication_required');      -- sessão antiga, refrescada agora
  perform pg_temp.t('D-04', 'authenticated', cd || jsonb_build_object('session_id', s_d_expired), 'select public.delete_my_account()', '28000 reauthentication_required');  -- not_after no passado
  perform pg_temp.t('D-05', 'authenticated', cd || jsonb_build_object('session_id', gen_random_uuid()), 'select public.delete_my_account()', '28000 reauthentication_required'); -- sessão revogada (linha apagada)
  perform pg_temp.t('D-06', 'authenticated', cd || jsonb_build_object('session_id', s_b_fresh), 'select public.delete_my_account()', '28000 reauthentication_required');    -- sessão de outro utilizador
  perform pg_temp.t('D-07', 'authenticated', cd || jsonb_build_object('session_id', 'nao-e-uuid'), 'select public.delete_my_account()', '28000 reauthentication_required');
  perform pg_temp.t('D-08', 'authenticated', jsonb_build_object('role', 'authenticated', 'sub', v_m, 'session_id', s_m_fresh), 'select public.delete_my_account()', '42501 account_managed');
  -- sessão verificada ANTES de revelar existência/gestão da conta (item 7)
  perform pg_temp.t('D-09', 'authenticated', jsonb_build_object('role', 'authenticated', 'sub', v_ghost, 'session_id', s_g_fresh), 'select public.delete_my_account()', '28000 reauthentication_required');
  perform pg_temp.t('D-09b', 'authenticated', jsonb_build_object('role', 'authenticated', 'sub', v_m), 'select public.delete_my_account()', '28000 reauthentication_required');
  perform pg_temp.t('D-09c', 'authenticated', cd || jsonb_build_object('session_id', s_d_fresh, 'is_anonymous', true), 'select public.delete_my_account()', '42501 not_authenticated');
  perform pg_temp.chk('D-10', 'recusas não apagaram nem anonimizaram nada',
    (select count(*) from auth.users where id in (v_d, v_m))::text || '/'
    || (select count(*) from public.suggestions where email is not null and lower(email) = 'd.lote2@example.invalid')::text, '2/2');

  -- ---------- delete_my_account: sucesso ----------
  perform pg_temp.t('D-11', 'authenticated', cd || jsonb_build_object('session_id', s_d_fresh), format('select * from public.set_activity_interest(%L, true)', v_act), 'val=(t,7)');
  perform pg_temp.t('D-12', 'authenticated', cd || jsonb_build_object('session_id', s_d_fresh), 'select public.delete_my_account()', 'rows=1');
  perform pg_temp.chk('D-13', 'auth.users D apagado', (select count(*) from auth.users where id = v_d)::text, '0');
  perform pg_temp.chk('D-14', 'favoritos/interesses/sessões/identidades/refresh tokens de D apagados (cascata)',
    (select count(*) from public.favorites where user_id = v_d) || '/' || (select count(*) from public.activity_interests where user_id = v_d)
    || '/' || (select count(*) from auth.sessions where user_id = v_d) || '/' || (select count(*) from auth.identities where user_id = v_d)
    || '/' || (select count(*) from auth.refresh_tokens where user_id = v_d::text), '0/0/0/0/0');
  perform pg_temp.chk('D-15', 'sugestões de D anonimizadas (email/phone/comment null), título e resto mantidos',
    (select string_agg(title || ':' || coalesce(email, '-') || ':' || coalesce(phone, '-') || ':' || coalesce(comment, '-')
                       || ':' || location || ':' || language || ':' || status, ';' order by title)
     from public.suggestions where title like 'Sugestao D%'),
    'Sugestao D 1:-:-:-:Lisboa:pt:pending;Sugestao D 2:-:-:-:Porto:en:pending');
  perform pg_temp.chk('D-16', 'sugestões de outros intactas',
    (select string_agg(title || ':' || coalesce(email, '-') || ':' || coalesce(phone, '-') || ':' || coalesce(comment, '-'), ';' order by title)
     from public.suggestions where title in ('Sugestao B', 'Sugestao anonima')),
    'Sugestao B:b.lote2@example.invalid:+351900000003:comentario B;Sugestao anonima:-:+351900000004:sem email');
  perform pg_temp.chk('D-17', 'outros utilizadores intactos (B, M; favorito e interesse de B)',
    (select count(*) from auth.users where id in (v_a, v_b, v_m)) || '/' || (select count(*) from public.favorites where user_id = v_b)
    || '/' || (select count(*) from public.activity_interests where user_id = v_b) || '/' || (select count(*) from auth.sessions where user_id = v_b), '3/1/1/1');
  -- DOCUMENTADO (contrato v1.1 item 4): a cascata NÃO decrementa o contador.
  perform pg_temp.chk('D-18', 'contador fica como estava depois da cascata (7, embora só B tenha linha)',
    (select interested_count || '/' || (select count(*) from public.activity_interests where activity_id = v_act) from public.activities where id = v_act), '7/1');
  perform pg_temp.t('D-19', 'authenticated', cd || jsonb_build_object('session_id', s_d_fresh), 'select public.delete_my_account()', '28000 reauthentication_required');
  -- e-mail não confirmado: conta apagada, sugestões com esse e-mail NÃO anonimizadas (item 5)
  perform pg_temp.t('D-20', 'authenticated', jsonb_build_object('role', 'authenticated', 'sub', v_u, 'session_id', s_u_fresh), 'select public.delete_my_account()', 'rows=1');
  perform pg_temp.chk('D-21', 'e-mail não confirmado: conta apagada, sugestão intacta',
    (select count(*) from auth.users where id = v_u) || '/' ||
    (select coalesce(email, '-') || ':' || coalesce(phone, '-') || ':' || coalesce(comment, '-') from public.suggestions where title = 'Sugestao U'),
    '0/b.lote2@example.invalid.unconfirmed:+351900000005:nao confirmado');

  -- ---------- relatório ----------
  select count(*) filter (where not ok), count(*),
         string_agg(rpad(id, 5) || ' | ' || rpad(papel, 13) || ' | ' || rpad(left(esperado, 40), 40) || ' | '
                    || rpad(left(obtido, 40), 40) || ' | ' || case when ok then 'PASS' else 'FAIL  ' || coalesce(msg, '') end,
                    E'\n' order by seq)
    into v_fail, v_total, v_report
  from t_results;
  raise notice E'\n%', v_report;
  raise notice 'LOTE2 RPC TESTES: % PASS, % FAIL de %', v_total - v_fail, v_fail, v_total;
  if v_fail > 0 then
    raise exception 'LOTE2 RPC TESTES FALHARAM: % FAIL de %', v_fail, v_total;
  end if;
end;
$main$;

rollback;
