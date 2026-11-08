-- ============================================================
-- Testes SÓ LOCAIS da compatibilidade com versões antigas da app
-- (0026 caminho legado transitório / 0027 revogação). REF: Lote 3.
--
-- Recusa correr fora da simulação local (vivere.sim = 'local').
-- Correr como superutilizador local numa base com supabase-sim.sql e a
-- cadeia aplicada, indicando o estado esperado:
--   psql -U supabase_admin -d l3c_x -v ON_ERROR_STOP=1 -v mode=legacy   -f lote3-compat-tests.local.sql
--     (0000..0026 ou 0027 + rollback da 0027: caminho legado aberto)
--   psql -U supabase_admin -d l3c_x -v ON_ERROR_STOP=1 -v mode=hardened -f lote3-compat-tests.local.sql
--     (0000..0024, 0000..0025 ou 0000..0027: caminho legado fechado)
--
-- "Cliente antigo" = o SQL que o PostgREST executa para os pedidos do app
-- mobile main c390c92 (ActivityModal.js / ActivityDetailScreen.js,
-- handleToggleFav): PATCH /activities?id=eq.X {interested_count: cache±1},
-- upsert/delete em activity_interests, como anon (sem sessão) ou
-- authenticated (com sessão), com SET LOCAL ROLE + request.jwt.claims.
-- "Cliente novo" = RPC set_activity_interest / get_my_interests (0024).
-- Tudo dentro de BEGIN ... ROLLBACK. Termina em erro se houver FAIL.
-- ============================================================
\set ON_ERROR_STOP 1
begin;
select set_config('l3c.mode', :'mode', true);

do $main$
declare
  v_mode text := current_setting('l3c.mode');
  L boolean;                                                 -- caminho legado aberto?
  uA uuid := '13c00000-0000-4000-8000-00000000000a';
  uB uuid := '13c00000-0000-4000-8000-00000000000b';
  a1 uuid := '13ca0000-0000-4000-8000-000000000001';         -- caminho legado básico
  a2 uuid := '13ca0000-0000-4000-8000-000000000002';         -- RPC
  a3 uuid := '13ca0000-0000-4000-8000-000000000003';         -- deriva (dupla contagem)
  a4 uuid := '13ca0000-0000-4000-8000-000000000004';         -- abuso (rajada anon)
  a5 uuid := '13ca0000-0000-4000-8000-000000000005';         -- cache desactualizada
  a6 uuid := '13ca0000-0000-4000-8000-000000000006';         -- intercalado RPC/legado
  anon_cl jsonb := '{"role":"anon"}';
  r text; i int; n int; t0 timestamptz; v_ms numeric;
  v_fail int; v_total int; v_rep text;
begin
  if coalesce(current_setting('vivere.sim', true), '') <> 'local' then
    raise exception 'Recusado: script só para a simulação local (vivere.sim).';
  end if;
  if v_mode not in ('legacy', 'hardened') then
    raise exception 'mode tem de ser legacy ou hardened (obtido: %)', v_mode;
  end if;
  L := v_mode = 'legacy';
  if pg_catalog.to_regprocedure('public.set_activity_interest(uuid, boolean)') is null then
    raise exception 'Pré-requisito: 0024 aplicada.';
  end if;

  create temp table t_res (seq serial, id text, status text, descr text, evidence text);

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

  create function pg_temp.rec(p_id text, p_status text, p_descr text, p_ev text) returns void
  language sql as $f$ insert into t_res(id, status, descr, evidence) values (p_id, p_status, p_descr, left(p_ev, 240)) $f$;

  create function pg_temp.chk(p_id text, p_descr text, p_cond boolean, p_ev text) returns void
  language sql as $f$
    select pg_temp.rec(p_id, case when coalesce(p_cond, false) then 'PASS' else 'FAIL' end, p_descr, coalesce(p_ev, ''))
  $f$;

  -- expect(): p_states = resultado exacto ('OK:rows=1', 'OK:(t,1)') ou SQLSTATE(s), separados por '|'
  create function pg_temp.expect(p_id text, p_descr text, p_role text, p_claims jsonb, p_sql text, p_states text)
  returns text language plpgsql as $f$
  declare r text; ok boolean;
  begin
    r := pg_temp.q(p_role, p_claims, p_sql);
    select coalesce(bool_or(case when t like 'OK%' then r = t else r like 'ERR:' || t || ':%' end), false)
      into ok from unnest(string_to_array(p_states, '|')) t;
    perform pg_temp.rec(p_id, case when ok then 'PASS' else 'FAIL' end,
                        p_descr || ' [esperado ' || p_states || ']', r);
    return r;
  end $f$;

  create function pg_temp.cl(p_sub uuid) returns jsonb language sql as $f$
    select jsonb_build_object('role', 'authenticated', 'aud', 'authenticated', 'sub', p_sub) $f$;
  create function pg_temp.cnt(p_act uuid) returns int language sql as $f$
    select interested_count from public.activities where id = p_act $f$;
  create function pg_temp.nrows(p_act uuid) returns int language sql as $f$
    select count(*)::int from public.activity_interests where activity_id = p_act $f$;
  -- PATCH do cliente antigo: valor absoluto calculado no telemóvel
  create function pg_temp.patch(p_act uuid, p_value int) returns text language sql as $f$
    select format('update public.activities set interested_count = %s where id = %L', p_value, p_act) $f$;

  -- ---------- fixtures ----------
  insert into auth.users(id, email) values (uA, 'l3c_a@x.test'), (uB, 'l3c_b@x.test');
  insert into public.activities(id, title, start_date, recurrence_type, interested_count)
  select x.id, 'l3c ' || x.n, now() + interval '7 days', 'none', x.c
  from (values (a1, 1, 0), (a2, 2, 0), (a3, 3, 0), (a4, 4, 0), (a5, 5, 7), (a6, 6, 0)) x(id, n, c);
  perform pg_temp.chk('S0', 'fixtures activas em active_activities', (select count(*) from public.active_activities
          where id in (a1, a2, a3, a4, a5, a6)) = 6, null);

  -- ==========================================================
  -- O: cliente antigo (c390c92)
  -- ==========================================================
  perform pg_temp.expect('O1', 'anon PATCH interested_count 0->1', 'anon', anon_cl, pg_temp.patch(a1, 1),
                         case when L then 'OK:rows=1' else '42501' end);
  perform pg_temp.chk('O1c', 'contador depois de O1', pg_temp.cnt(a1) = case when L then 1 else 0 end, pg_temp.cnt(a1)::text);
  perform pg_temp.expect('O2', 'authenticated (sessão) PATCH +1', 'authenticated', pg_temp.cl(uA),
                         pg_temp.patch(a1, pg_temp.cnt(a1) + 1),
                         case when L then 'OK:rows=1' else 'OK:rows=0' end);   -- H: RLS sem política -> 0 linhas
  perform pg_temp.chk('O2c', 'contador depois de O2', pg_temp.cnt(a1) = case when L then 2 else 0 end, pg_temp.cnt(a1)::text);
  perform pg_temp.expect('O3', 'anon PATCH -1 (desmarcar)', 'anon', anon_cl, pg_temp.patch(a1, pg_temp.cnt(a1) - 1),
                         case when L then 'OK:rows=1' else '42501' end);
  perform pg_temp.expect('O4', 'anon PATCH na forma PostgREST (json_populate_record)', 'anon', anon_cl,
    format('update public.activities set interested_count = b.interested_count
              from (select * from json_populate_record(null::public.activities, %L::json)) b
             where public.activities.id = %L', json_build_object('interested_count', pg_temp.cnt(a1) + 1), a1),
    case when L then 'OK:rows=1' else '42501' end);
  perform pg_temp.expect('O5', 'anon PATCH com RETURNING id (return=representation)', 'anon', anon_cl,
    pg_temp.patch(a1, pg_temp.cnt(a1) - 1) || ' returning id', case when L then 'OK:rows=1' else '42501' end);
  perform pg_temp.chk('O5c', 'contador a1 final do bloco O1..O5', pg_temp.cnt(a1) = case when L then 1 else 0 end, pg_temp.cnt(a1)::text);
  -- limites do caminho legado (trigger guard + privilégio de coluna)
  perform pg_temp.expect('O6', 'anon PATCH +2 recusado (guard)', 'anon', anon_cl, pg_temp.patch(a1, pg_temp.cnt(a1) + 2),
                         case when L then 'P0001' else '42501' end);
  perform pg_temp.expect('O7', 'anon PATCH abaixo de 0 recusado', 'anon', anon_cl, pg_temp.patch(a6, -1),
                         case when L then 'P0001' else '42501' end);
  perform pg_temp.expect('O8', 'anon PATCH de outra coluna (title) recusado', 'anon', anon_cl,
                         format('update public.activities set title = %L where id = %L', 'x', a1), '42501');
  perform pg_temp.expect('O9', 'authenticated PATCH de outra coluna (title) recusado', 'authenticated', pg_temp.cl(uA),
                         format('update public.activities set title = %L where id = %L', 'x', a1),
                         case when L then 'P0001' else 'OK:rows=0' end);
  perform pg_temp.chk('O9c', 'title intacto', (select title from public.activities where id = a1) = 'l3c 1', null);
  -- cache desactualizada no telemóvel (actual = 7)
  perform pg_temp.expect('O10', 'cache 5 (actual 7), marca -> escreve 6: aceite como -1', 'anon', anon_cl,
                         pg_temp.patch(a5, 6), case when L then 'OK:rows=1' else '42501' end);
  perform pg_temp.chk('O10c', 'marcar com cache 2 atrás: aberto DECREMENTA (6), fechado fica 7', pg_temp.cnt(a5) = case when L then 6 else 7 end, pg_temp.cnt(a5)::text);
  perform pg_temp.expect('O11', 'cache 5 (actual 6), marca -> escreve 6: delta 0, perdido', 'anon', anon_cl,
                         pg_temp.patch(a5, 6), case when L then 'OK:rows=1' else '42501' end);
  perform pg_temp.chk('O11c', 'contador continua 6', pg_temp.cnt(a5) = case when L then 6 else 7 end, pg_temp.cnt(a5)::text);
  perform pg_temp.expect('O12', 'cache 1 (actual 6), marca -> escreve 2: recusado (guard)', 'anon', anon_cl,
                         pg_temp.patch(a5, 2), case when L then 'P0001' else '42501' end);
  -- escritas que o app antigo faz e que JÁ falhavam antes da 0024 (não repostas)
  perform pg_temp.expect('O13', 'anon upsert em activity_interests negado', 'anon', anon_cl,
    format('insert into public.activity_interests(activity_id, device_id) values (%L, %L)
            on conflict (activity_id, device_id) do update set user_id = excluded.user_id', a1, 'dev-1'), '42501');
  perform pg_temp.expect('O14', 'authenticated upsert em activity_interests negado', 'authenticated', pg_temp.cl(uA),
    format('insert into public.activity_interests(activity_id, user_id) values (%L, %L)', a1, uA), '42501');
  perform pg_temp.expect('O15', 'anon delete em activity_interests negado', 'anon', anon_cl,
    format('delete from public.activity_interests where activity_id = %L and device_id = %L', a1, 'dev-1'), '42501');
  perform pg_temp.expect('O16', 'authenticated delete em activity_interests negado', 'authenticated', pg_temp.cl(uA),
    format('delete from public.activity_interests where activity_id = %L and user_id = %L', a1, uA), '42501');
  perform pg_temp.expect('O17', 'anon escrita em active_activities negada', 'anon', anon_cl,
    format('update public.active_activities set interested_count = 0 where id = %L', a1), '42501');
  perform pg_temp.expect('O18', 'anon increment_activity_interest negado', 'anon', anon_cl,
    format('select public.increment_activity_interest(%L, 1::smallint)', a1), '42501');
  perform pg_temp.expect('O19', 'authenticated increment_activity_interest negado', 'authenticated', pg_temp.cl(uA),
    format('select public.increment_activity_interest(%L, 1::smallint)', a1), '42501');
  perform pg_temp.expect('O20', 'anon leitura de active_activities (listas do app antigo)', 'anon', anon_cl,
    format('select count(*) from public.active_activities where id = %L', a1), 'OK:(1)');
  perform pg_temp.chk('O21', 'nenhuma linha em activity_interests criada pelo caminho legado',
                      (select count(*) from public.activity_interests where activity_id in (a1, a5)) = 0, null);

  -- ==========================================================
  -- N: cliente novo (RPC) funciona nos dois estados
  -- ==========================================================
  perform pg_temp.expect('N1', 'uA set_activity_interest(a2, true)', 'authenticated', pg_temp.cl(uA),
    format('select * from public.set_activity_interest(%L, true)', a2), 'OK:(t,1)');
  perform pg_temp.expect('N2', 'uA repete true: idempotente', 'authenticated', pg_temp.cl(uA),
    format('select * from public.set_activity_interest(%L, true)', a2), 'OK:(t,1)');
  perform pg_temp.expect('N3', 'uA get_my_interests', 'authenticated', pg_temp.cl(uA),
    format('select * from public.get_my_interests(array[%L, %L]::uuid[])', a1, a2), 'OK:(' || a2::text || ')');
  perform pg_temp.expect('N4', 'anon set_activity_interest negado', 'anon', anon_cl,
    format('select * from public.set_activity_interest(%L, true)', a2), '42501');
  perform pg_temp.expect('N5', 'uA set_activity_interest(a2, false)', 'authenticated', pg_temp.cl(uA),
    format('select * from public.set_activity_interest(%L, false)', a2), 'OK:(f,0)');
  perform pg_temp.chk('N6', 'a2 contador = linhas = 0', pg_temp.cnt(a2) = 0 and pg_temp.nrows(a2) = 0, pg_temp.cnt(a2)::text);

  -- ==========================================================
  -- D: interacção caminho legado x RPC (deriva do contador)
  -- ==========================================================
  -- D1 uB marcou na versão antiga (PATCH 0->1, sem linha); actualiza a app e marca de novo pela RPC
  perform pg_temp.q('authenticated', pg_temp.cl(uB), pg_temp.patch(a3, 1));
  perform pg_temp.q('authenticated', pg_temp.cl(uB), format('select * from public.set_activity_interest(%L, true)', a3));
  perform pg_temp.chk('D1', 'mesma pessoa: legado + RPC -> contador ' || case when L then '2' else '1' end || ', 1 linha',
                      pg_temp.cnt(a3) = case when L then 2 else 1 end and pg_temp.nrows(a3) = 1,
                      pg_temp.cnt(a3) || '/' || pg_temp.nrows(a3));
  -- D2 desmarca na versão nova: a RPC só retira o +1 dela; o +1 legado fica
  perform pg_temp.q('authenticated', pg_temp.cl(uB), format('select * from public.set_activity_interest(%L, false)', a3));
  perform pg_temp.chk('D2', 'depois de desmarcar na RPC: deriva residual ' || case when L then '+1' else '0' end,
                      pg_temp.cnt(a3) - pg_temp.nrows(a3) = case when L then 1 else 0 end,
                      pg_temp.cnt(a3) || '/' || pg_temp.nrows(a3));
  -- D3 RPC e cliente antigo intercalados: o PATCH antigo com cache anterior à RPC fica delta 0 (perdido).
  --    Com 2+ RPC entre a leitura e o PATCH o delta é -1: o PATCH apaga um +1 da RPC (ver T6).
  perform pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.set_activity_interest(%L, true)', a6));
  r := pg_temp.q('anon', anon_cl, pg_temp.patch(a6, 1));   -- telemóvel tinha 0 em cache
  perform pg_temp.chk('D3', 'PATCH antigo com cache anterior à RPC: delta 0, o +1 do telemóvel perde-se (contador 1, linhas 1)',
                      pg_temp.cnt(a6) = 1 and pg_temp.nrows(a6) = 1, r || ' ' || pg_temp.cnt(a6) || '/' || pg_temp.nrows(a6));
  -- D4 o PATCH antigo seguinte (cache 1 -> 2) soma +1 sem linha
  r := pg_temp.q('anon', anon_cl, pg_temp.patch(a6, 2));
  perform pg_temp.chk('D4', 'PATCH antigo seguinte: contador ' || case when L then '2' else '1' end || ', linhas 1',
                      pg_temp.cnt(a6) = case when L then 2 else 1 end and pg_temp.nrows(a6) = 1, r);
  -- D5 RPC desmarca: contador nunca abaixo de 0 e só -1
  perform pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.set_activity_interest(%L, false)', a6));
  perform pg_temp.chk('D5', 'RPC false depois do legado: contador ' || case when L then '1' else '0' end || ', linhas 0',
                      pg_temp.cnt(a6) = case when L then 1 else 0 end and pg_temp.nrows(a6) = 0,
                      pg_temp.cnt(a6) || '/' || pg_temp.nrows(a6));

  -- ==========================================================
  -- A: abuso (quantificação): script com a chave anon, ler + escrever +1
  -- ==========================================================
  t0 := clock_timestamp(); n := 0;
  for i in 1..500 loop
    r := pg_temp.q('anon', anon_cl, pg_temp.patch(a4, pg_temp.cnt(a4) + 1));
    if r = 'OK:rows=1' then n := n + 1; end if;
  end loop;
  v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
  perform pg_temp.chk('A1', '500 pedidos anon +1: contador ' || case when L then '500' else '0' end || ' sem nenhuma linha',
                      pg_temp.cnt(a4) = case when L then 500 else 0 end and pg_temp.nrows(a4) = 0,
                      'aceites=' || n || ' contador=' || pg_temp.cnt(a4) || ' tempo_ms=' || round(v_ms));
  perform pg_temp.rec('A1i', 'INFO', 'ritmo local do abuso (sem rede/PostgREST)',
                      round(500 / greatest(v_ms, 1) * 1000) || ' pedidos/s');
  for i in 1..600 loop
    r := pg_temp.q('anon', anon_cl, pg_temp.patch(a4, greatest(pg_temp.cnt(a4) - 1, 0)));
  end loop;
  perform pg_temp.chk('A2', 'pedidos anon -1 levam o contador a 0 (nunca negativo)', pg_temp.cnt(a4) = 0, pg_temp.cnt(a4)::text);
  -- a RPC continua idempotente (abuso por utilizador limitado a 1)
  for i in 1..50 loop
    perform pg_temp.q('authenticated', pg_temp.cl(uA), format('select * from public.set_activity_interest(%L, true)', a4));
  end loop;
  perform pg_temp.chk('A3', '50 chamadas RPC do mesmo utilizador: +1 só', pg_temp.cnt(a4) = 1 and pg_temp.nrows(a4) = 1,
                      pg_temp.cnt(a4) || '/' || pg_temp.nrows(a4));

  -- ---------- relatório ----------
  for v_rep in select id || ' | ' || status || ' | ' || descr || ' | ' || evidence from t_res order by seq loop
    raise notice '%', v_rep;
  end loop;
  select count(*) filter (where status = 'FAIL'), count(*) filter (where status <> 'INFO') into v_fail, v_total from t_res;
  raise notice 'LOTE3 COMPAT (%): % PASS, % FAIL de %', v_mode, v_total - v_fail, v_fail, v_total;
  if v_fail > 0 then
    raise exception 'LOTE3 COMPAT: % FAIL', v_fail;
  end if;
end;
$main$;

rollback;
