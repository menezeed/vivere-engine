-- ============================================================
-- Testes da migração 0028 (orçamento persistente) — SÓ STAGING,
-- ROLLBACK GARANTIDO
-- REF: L5. Executar só com REF próprio, depois de aplicar a 0028.
--
-- ESTADO: escrito, NÃO EXECUTADO (não havia PostgreSQL local nem
-- autorização para correr no staging).
--
-- O QUE FAZ
-- Dentro de UMA transacção e de UM bloco DO: cria configurações
-- sintéticas só com fornecedores 'qa-*' e exercita as RPC e o trigger
-- como service_role, anon e authenticated (SET LOCAL ROLE, o mesmo
-- mecanismo do PostgREST). Nunca chama nenhuma API paga.
--
-- ROLLBACK GARANTIDO
-- O bloco termina SEMPRE com RAISE EXCEPTION, cuja mensagem é o
-- relatório; a excepção desfaz tudo (configs qa-*, reservas, tabela e
-- função temporárias). O ROLLBACK final cobre o caso de o cliente não
-- abortar sozinho. Nada persiste.
--
-- NUNCA EM PRODUÇÃO. A base de dados não sabe o próprio ref: o operador
-- confirma o projecto pelo URL do Dashboard e escreve v_confirm.
--
-- CONCORRÊNCIA: o SQL Editor só tem uma sessão, por isso o teste C1/C2
-- é "estilo concorrente" (duas reservas seguidas, de execuções
-- diferentes, perto do tecto: só uma passa). A prova com duas sessões
-- reais (o pg_advisory_xact_lock serializa; a 2.ª espera e depois é
-- recusada) exige dois psql em paralelo — fora deste ficheiro:
--   sessão 1: begin; select * from staging.reserve_api_budget('qa-conc', 'qa', gen_random_uuid(), null, 0.06);
--   sessão 2: (mesma chamada; fica bloqueada até a sessão 1 terminar)
--   sessão 1: commit;  → sessão 2 devolve allowed=false, monthly_cap
--   (com config qa-conc monthly 0.10; apagar depois como postgres não
--   é possível — append-only — por isso só numa base descartável).
--
-- LEITURA: id | papel | esperado | obtido | PASS/FAIL
--   valores de texto devolvidos pela consulta, ou err:SQLSTATE
--   (42501 = sem privilégio; 23514 = recusado pelo trigger/CHECK;
--    P0002 = reserva inexistente ou já liquidada)
-- ============================================================

begin;

do $main$
declare
  v_confirm text := 'NAO_CONFIRMADO';   -- <<< escrever: staging (depois de ver o projecto no URL)
  v_run_a   uuid := gen_random_uuid();
  v_run_b   uuid := gen_random_uuid();
  v_id      text;
  v_id2     text;
  v_report  text;
  v_fail    int;
begin
  -- ---------- guardas ----------
  perform set_config('lock_timeout', '2s', true);
  perform set_config('statement_timeout', '30s', true);
  if v_confirm <> 'staging' then
    raise exception 'Abortado: confirmar o ambiente (v_confirm = staging) depois de ver o projecto no URL.';
  end if;
  if pg_catalog.to_regclass('staging.api_usage_log') is null then
    raise exception 'Abortado: 0028 não aplicada (staging.api_usage_log não existe).';
  end if;
  if exists (select 1 from staging.api_budget_config where provider like 'qa-%') then
    raise exception 'Abortado: já existem configs qa-* (não deviam persistir).';
  end if;

  -- ---------- infraestrutura temporária ----------
  create temp table t_results (seq serial, id text, papel text, esperado text, obtido text, ok boolean);

  -- Executa p_sql (devolve 1 valor de texto) como p_role; erro → 'err:SQLSTATE'.
  create function pg_temp.q(p_role text, p_sql text) returns text
  language plpgsql as $f$
  declare v text;
  begin
    begin
      execute format('set local role %I', p_role);
      execute p_sql into v;
      reset role;
      return coalesce(v, '<null>');
    exception when others then
      reset role;
      return 'err:' || sqlstate;
    end;
  end;
  $f$;

  create function pg_temp.chk(p_id text, p_role text, p_got text, p_expect text) returns void
  language sql as $f$
    insert into t_results (id, papel, esperado, obtido, ok)
    values (p_id, p_role, p_expect, p_got, p_got = p_expect);
  $f$;

  -- ---------- fixtures (como postgres; só qa-*) ----------
  insert into staging.api_budget_config
    (provider, monthly_budget_usd, daily_budget_usd, per_run_budget_usd, hard_stop_enabled, updated_by)
  values
    ('qa-month', 0.10, null, null, true,  'qa-l5'),
    ('qa-day',   10.0, 0.05, null, true,  'qa-l5'),
    ('qa-run',   10.0, null, 0.05, true,  'qa-l5'),
    ('qa-soft',  0.01, null, null, false, 'qa-l5');

  -- ---------- F: fail-closed sem config ----------
  perform pg_temp.chk('F1 sem config recusa', 'service_role', pg_temp.q('service_role',
    $s$select allowed::text || ',' || reason from staging.reserve_api_budget('qa-sem-config', 'qa', gen_random_uuid(), null, 0.01)$s$),
    'false,no_config');
  perform pg_temp.chk('F2 sem config nada inserido', 'postgres',
    (select count(*)::text from staging.api_usage_log where provider = 'qa-sem-config'), '0');
  perform pg_temp.chk('F3 custo negativo recusa', 'service_role', pg_temp.q('service_role',
    $s$select allowed::text || ',' || reason from staging.reserve_api_budget('qa-month', 'qa', gen_random_uuid(), null, -1)$s$),
    'false,invalid_arguments');

  -- ---------- C: dupla reserva perto do tecto (estilo concorrente) ----------
  v_id := pg_temp.q('service_role', format(
    $s$select reservation_id::text from staging.reserve_api_budget('qa-month', 'qa', %L, null, 0.06) where allowed$s$, v_run_a));
  perform pg_temp.chk('C1 1.a reserva passa', 'service_role', (v_id ~ '^[0-9]+$')::text, 'true');
  perform pg_temp.chk('C2 2.a reserva (outra execucao) recusada', 'service_role', pg_temp.q('service_role', format(
    $s$select allowed::text || ',' || reason || ',' || spent_month_usd::text from staging.reserve_api_budget('qa-month', 'qa', %L, null, 0.06)$s$, v_run_b)),
    'false,monthly_cap,0.0600');
  perform pg_temp.chk('C3 recusa nao insere', 'postgres',
    (select count(*)::text from staging.api_usage_log where provider = 'qa-month'), '1');

  -- ---------- D/R: tecto diário e por execução ----------
  perform pg_temp.q('service_role', $s$select allowed::text from staging.reserve_api_budget('qa-day', 'qa', gen_random_uuid(), null, 0.03)$s$);
  perform pg_temp.chk('D1 tecto diario', 'service_role', pg_temp.q('service_role',
    $s$select allowed::text || ',' || reason from staging.reserve_api_budget('qa-day', 'qa', gen_random_uuid(), null, 0.03)$s$),
    'false,daily_cap');
  perform pg_temp.q('service_role', format($s$select allowed::text from staging.reserve_api_budget('qa-run', 'qa', %L, null, 0.03)$s$, v_run_a));
  perform pg_temp.chk('R1 tecto por execucao (mesma run)', 'service_role', pg_temp.q('service_role', format(
    $s$select allowed::text || ',' || reason from staging.reserve_api_budget('qa-run', 'qa', %L, null, 0.03)$s$, v_run_a)),
    'false,per_run_cap');
  perform pg_temp.chk('R2 outra execucao passa', 'service_role', pg_temp.q('service_role', format(
    $s$select allowed::text from staging.reserve_api_budget('qa-run', 'qa', %L, null, 0.03)$s$, v_run_b)),
    'true');

  -- ---------- S: hard_stop desligado ----------
  perform pg_temp.chk('S1 hard_stop=false permite com aviso', 'service_role', pg_temp.q('service_role',
    $s$select allowed::text || ',' || reason from staging.reserve_api_budget('qa-soft', 'qa', gen_random_uuid(), null, 0.05)$s$),
    'true,soft_monthly_cap');

  -- ---------- T: transições (trigger) ----------
  perform pg_temp.chk('T1 confirm reserved->spent', 'service_role',
    pg_temp.q('service_role', format($s$select staging.confirm_api_spend(%s)::text$s$, v_id)), '');
  perform pg_temp.chk('T2 estado spent', 'postgres',
    (select status || ',' || (settled_at is not null)::text from staging.api_usage_log where id = v_id::bigint), 'spent,true');
  perform pg_temp.chk('T3 confirm repetido', 'service_role',
    pg_temp.q('service_role', format($s$select staging.confirm_api_spend(%s)::text$s$, v_id)), 'err:P0002');
  perform pg_temp.chk('T4 release de spent', 'service_role',
    pg_temp.q('service_role', format($s$select staging.release_api_budget(%s)::text$s$, v_id)), 'err:P0002');
  perform pg_temp.chk('T5 update spent->reserved', 'service_role',
    pg_temp.q('service_role', format($s$update staging.api_usage_log set status = 'reserved' where id = %s returning 'x'$s$, v_id)), 'err:23514');
  perform pg_temp.chk('T6 update de custo (sem privilegio de coluna)', 'service_role',
    pg_temp.q('service_role', format($s$update staging.api_usage_log set estimated_cost_usd = 0 where id = %s returning 'x'$s$, v_id)), 'err:42501');
  perform pg_temp.chk('T7 update de custo como dono (trigger)', 'postgres',
    pg_temp.q('postgres', format($s$update staging.api_usage_log set estimated_cost_usd = 0 where id = %s returning 'x'$s$, v_id)), 'err:23514');
  perform pg_temp.chk('T8 insert directo spent', 'service_role',
    pg_temp.q('service_role', format($s$insert into staging.api_usage_log (provider, call_type, run_key, estimated_cost_usd, status) values ('qa-month', 'qa', %L, 0, 'spent') returning 'x'$s$, v_run_a)), 'err:23514');
  perform pg_temp.chk('T9 delete service_role', 'service_role',
    pg_temp.q('service_role', format($s$delete from staging.api_usage_log where id = %s returning 'x'$s$, v_id)), 'err:42501');
  perform pg_temp.chk('T10 delete dono (trigger)', 'postgres',
    pg_temp.q('postgres', format($s$delete from staging.api_usage_log where id = %s returning 'x'$s$, v_id)), 'err:23514');
  perform pg_temp.chk('T11 truncate dono (trigger)', 'postgres',
    pg_temp.q('postgres', $s$truncate staging.api_usage_log$s$), 'err:23514');

  -- release liberta o tecto
  v_id2 := pg_temp.q('service_role', format(
    $s$select reservation_id::text from staging.reserve_api_budget('qa-run', 'qa', %L, null, 0.01) where allowed$s$, v_run_a));
  perform pg_temp.chk('T12 release reserved->released', 'service_role',
    pg_temp.q('service_role', format($s$select staging.release_api_budget(%s)::text$s$, v_id2)), '');
  perform pg_temp.chk('T13 released nao conta (spent_run)', 'service_role', pg_temp.q('service_role', format(
    $s$select allowed::text || ',' || spent_run_usd::text from staging.reserve_api_budget('qa-run', 'qa', %L, null, 0.01)$s$, v_run_a)),
    'true,0.0400');

  -- ---------- P: privilégios ----------
  perform pg_temp.chk('P1 service_role nao escreve config', 'service_role',
    pg_temp.q('service_role', $s$insert into staging.api_budget_config (provider, monthly_budget_usd, updated_by) values ('qa-x', 1, 'qa') returning 'x'$s$), 'err:42501');
  perform pg_temp.chk('P2 service_role le config', 'service_role',
    pg_temp.q('service_role', $s$select count(*)::text from staging.api_budget_config where provider = 'qa-month'$s$), '1');
  perform pg_temp.chk('P3 anon le config', 'anon',
    pg_temp.q('anon', $s$select count(*)::text from staging.api_budget_config$s$), 'err:42501');
  perform pg_temp.chk('P4 anon le log', 'anon',
    pg_temp.q('anon', $s$select count(*)::text from staging.api_usage_log$s$), 'err:42501');
  perform pg_temp.chk('P5 anon insere log', 'anon',
    pg_temp.q('anon', format($s$insert into staging.api_usage_log (provider, call_type, run_key, estimated_cost_usd) values ('qa-month', 'qa', %L, 0) returning 'x'$s$, v_run_a)), 'err:42501');
  perform pg_temp.chk('P6 anon reserva', 'anon',
    pg_temp.q('anon', $s$select allowed::text from staging.reserve_api_budget('qa-month', 'qa', gen_random_uuid(), null, 0)$s$), 'err:42501');
  perform pg_temp.chk('P7 authenticated le config', 'authenticated',
    pg_temp.q('authenticated', $s$select count(*)::text from staging.api_budget_config$s$), 'err:42501');
  perform pg_temp.chk('P8 authenticated le log', 'authenticated',
    pg_temp.q('authenticated', $s$select count(*)::text from staging.api_usage_log$s$), 'err:42501');
  perform pg_temp.chk('P9 authenticated confirma', 'authenticated',
    pg_temp.q('authenticated', format($s$select staging.confirm_api_spend(%s)::text$s$, v_id2)), 'err:42501');
  perform pg_temp.chk('P10 authenticated liberta', 'authenticated',
    pg_temp.q('authenticated', format($s$select staging.release_api_budget(%s)::text$s$, v_id2)), 'err:42501');

  -- ---------- relatório (e rollback garantido) ----------
  select count(*) filter (where not ok),
         string_agg(format('%s | %s | %s | %s | %s', id, papel, esperado, obtido,
                           case when ok then 'PASS' else 'FAIL' end), E'\n' order by seq)
    into v_fail, v_report
    from t_results;

  raise exception E'RELATORIO 0028 (rollback garantido): % FAIL de %\n%',
    v_fail, (select count(*) from t_results), v_report;
end;
$main$;

rollback;
