-- ============================================================
-- Experiência SÓ LOCAL: que privilégios exigem as operações do app em
-- public.activity_interests? (REF: VIVERE-SEC-O-016B, decisão da 0024)
--
-- Recusa correr fora da simulação local (vivere.sim = 'local', definido
-- por supabase-sim.sql). Não altera RLS. Concede variantes de privilégios
-- DENTRO de um bloco que termina sempre em RAISE EXCEPTION: tudo é
-- desfeito. Pré-requisito: auth.users com os UUID de teste abaixo.
-- ============================================================
do $main$
declare
  v_a uuid := '00000000-0000-4000-8000-00000000000a';
  v_act uuid;
  v_report text;
  -- SQL igual ao gerado para o upsert do app (on_conflict + merge-duplicates)
  up_anon text;
  up_auth text;
  ins_plain text;
begin
  if coalesce(current_setting('vivere.sim', true), '') <> 'local' then
    raise exception 'Recusado: script só para a simulação local (vivere.sim).';
  end if;

  create temp table t_results (seq serial, id text, papel text, variante text, obtido text, msg text);
  create function pg_temp.t(p_id text, p_role text, p_sub uuid, p_var text, p_sql text)
  returns void language plpgsql as $f$
  declare n bigint := 0; st text := 'OK'; m text := '';
  begin
    perform set_config('request.jwt.claims',
      case when p_role = 'anon' then '{"role":"anon"}'
           else json_build_object('role', 'authenticated', 'sub', p_sub)::text end, true);
    execute format('set local role %I', p_role);
    begin execute p_sql; get diagnostics n = row_count;
    exception when others then st := sqlstate; m := sqlerrm; end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into t_results(id, papel, variante, obtido, msg) values (p_id, p_role, p_var,
      case when st = 'OK' then 'rows=' || n
           when st = '42501' and m ilike '%row-level security%' then 'deny_rls'
           when st = '42501' then 'deny_grant' else 'err:' || st end, left(m, 90));
  end $f$;

  insert into public.activities(title, start_date, recurrence_type)
    values ('SEC-O-016B fixture', now() + interval '7 days', 'none') returning id into v_act;
  insert into public.activity_interests(activity_id, user_id) values (v_act, v_a);  -- linha de outro utilizador
  insert into public.activity_interests(activity_id, device_id) values (v_act, 'dev_outro');

  up_anon := format('insert into public.activity_interests(activity_id, user_id, device_id) values (%L, null, %%L) '
    'on conflict (activity_id, device_id) do update set activity_id = excluded.activity_id, '
    'user_id = excluded.user_id, device_id = excluded.device_id', v_act);
  ins_plain := format('insert into public.activity_interests(activity_id, user_id, device_id) values (%L, null, %%L)', v_act);

  -- Ponto de partida: nenhum privilégio de anon/authenticated na tabela
  revoke all on public.activity_interests from anon, authenticated;

  -- V0..V4: upsert anónimo (linha nova, sem conflito)
  perform pg_temp.t('V0', 'anon', null, 'sem privilégios', format(up_anon, 'dev_v0'));
  grant insert (activity_id, user_id, device_id) on public.activity_interests to anon;
  perform pg_temp.t('V1', 'anon', null, 'INSERT(3)', format(up_anon, 'dev_v1'));
  perform pg_temp.t('P1', 'anon', null, 'INSERT(3), INSERT simples sem ON CONFLICT', format(ins_plain, 'dev_p1'));
  perform pg_temp.t('P2', 'anon', null, 'INSERT(3), ON CONFLICT (arbitro) DO NOTHING',
    format('insert into public.activity_interests(activity_id, user_id, device_id) values (%L, null, %L) '
           'on conflict (activity_id, device_id) do nothing', v_act, 'dev_p2'));
  perform pg_temp.t('P2c', 'anon', null, 'idem, repetir (conflito)',
    format('insert into public.activity_interests(activity_id, user_id, device_id) values (%L, null, %L) '
           'on conflict (activity_id, device_id) do nothing', v_act, 'dev_p2'));
  grant update (activity_id, user_id, device_id) on public.activity_interests to anon;
  perform pg_temp.t('V2', 'anon', null, 'INSERT(3)+UPDATE(3)', format(up_anon, 'dev_v2'));
  grant select (activity_id, device_id) on public.activity_interests to anon;
  perform pg_temp.t('V3', 'anon', null, 'INSERT(3)+UPDATE(3)+SELECT(activity_id,device_id)', format(up_anon, 'dev_v3'));
  perform pg_temp.t('V3c', 'anon', null, 'idem, repetir (conflito)', format(up_anon, 'dev_v3'));
  perform pg_temp.t('V6', 'anon', null, 'V3, mas SET so device_id = excluded.device_id',
    format('insert into public.activity_interests(activity_id, user_id, device_id) values (%L, null, %L) '
           'on conflict (activity_id, device_id) do update set device_id = excluded.device_id', v_act, 'dev_v6'));
  grant select (user_id) on public.activity_interests to anon;
  perform pg_temp.t('V4', 'anon', null, 'INSERT(3)+UPDATE(3)+SELECT(3)', format(up_anon, 'dev_v4'));
  perform pg_temp.t('V4c', 'anon', null, 'idem, repetir (conflito)', format(up_anon, 'dev_v4'));
  revoke select (user_id) on public.activity_interests from anon;
  perform pg_temp.t('X1', 'anon', null, 'exposicao: ler device_id de todos', 'select device_id from public.activity_interests');
  perform pg_temp.t('X2', 'anon', null, 'exposicao: ler user_id', 'select user_id from public.activity_interests');
  -- Variante sem UPDATE: só SELECT das colunas de conflito
  revoke update (activity_id, user_id, device_id) on public.activity_interests from anon;
  perform pg_temp.t('V5', 'anon', null, 'INSERT(3)+SELECT(arbitro), sem UPDATE', format(up_anon, 'dev_v5'));
  revoke all on public.activity_interests from anon;

  -- Authenticated: upsert e DELETE do app
  up_auth := format('insert into public.activity_interests(activity_id, user_id, device_id) values (%L, %L, null) '
    'on conflict (activity_id, device_id) do update set activity_id = excluded.activity_id, '
    'user_id = excluded.user_id, device_id = excluded.device_id', v_act, '00000000-0000-4000-8000-00000000000b');
  grant insert (activity_id, user_id, device_id), update (activity_id, user_id, device_id)
    on public.activity_interests to authenticated;
  perform pg_temp.t('U1', 'authenticated', '00000000-0000-4000-8000-00000000000b', 'INSERT(3)+UPDATE(3)', up_auth);
  grant select (activity_id, device_id) on public.activity_interests to authenticated;
  perform pg_temp.t('U2', 'authenticated', '00000000-0000-4000-8000-00000000000b', '+SELECT(activity_id,device_id)', up_auth);
  grant delete on public.activity_interests to authenticated;
  perform pg_temp.t('D1', 'authenticated', '00000000-0000-4000-8000-00000000000b', 'DELETE+SELECT(activity_id,device_id)',
    format('delete from public.activity_interests where activity_id = %L and user_id = %L', v_act, '00000000-0000-4000-8000-00000000000b'));
  grant select (user_id) on public.activity_interests to authenticated;
  perform pg_temp.t('D2', 'authenticated', '00000000-0000-4000-8000-00000000000b', 'DELETE+SELECT(3)',
    format('delete from public.activity_interests where activity_id = %L and user_id = %L', v_act, '00000000-0000-4000-8000-00000000000b'));
  perform pg_temp.t('X3', 'authenticated', '00000000-0000-4000-8000-00000000000b', 'exposicao: ler user_id de outros',
    format('select user_id from public.activity_interests where user_id = %L', v_a));

  select string_agg(rpad(id, 4) || ' | ' || rpad(papel, 13) || ' | ' || rpad(variante, 52) || ' | ' || rpad(obtido, 10)
                    || coalesce(' | ' || nullif(msg, ''), ''), E'\n' order by seq)
    into v_report from t_results;
  raise exception E'activity_interests (ROLLBACK, nada gravado)\n%', v_report;
end;
$main$;
