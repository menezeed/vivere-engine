-- ============================================================
-- Testes de acesso do app mobile — SÓ STAGING, ROLLBACK GARANTIDO
-- REF: VIVERE-SEC-O-016 (desenho). Executar só com REF próprio.
--
-- O QUE FAZ
-- Corre, dentro de UM bloco DO, as operações reais do app como `anon` e
-- como `authenticated` (mesmo mecanismo do PostgREST: SET LOCAL ROLE +
-- request.jwt.claims), sobre fixtures sintéticas criadas no próprio
-- bloco. Testes positivos (o app tem de conseguir) e negativos (tem de
-- ser negado, distinguindo GRANT de RLS).
--
-- ROLLBACK GARANTIDO
-- O bloco termina SEMPRE com RAISE EXCEPTION, cuja mensagem é o
-- relatório. A excepção desfaz tudo: fixtures, linhas de teste, função
-- e tabela temporárias. Nada persiste, em qualquer cliente (SQL Editor
-- ou psql). Se o relatório não aparecer, nada foi gravado na mesma.
--
-- NUNCA EM PRODUÇÃO: mesmo com rollback, dispara triggers e toma locks
-- em tabelas usadas pelos testers. A base de dados não sabe o próprio
-- ref; por isso há três guardas (S4, SEC-O-016B):
--   * o operador escreve o ref do projecto que vê no URL (v_ref) e tem de
--     ser o do staging;
--   * recusa se auth.users tiver 20 ou mais contas (protege projectos
--     com utilizadores reais);
--   * lock_timeout 2 s e statement_timeout 30 s: se alguma tabela estiver
--     ocupada, o bloco falha em vez de esperar (e desfaz tudo).
--
-- PRÉ-REQUISITOS
--  1. Dashboard no projecto vivere-staging, ref jvtcgomwbfojsttepcfc no URL.
--  2. 0000–0022 e 0023 aplicadas (antes da 0023, as linhas marcadas
--     [0023] devem falhar: é o diagnóstico D1). A 0024 está BLOQUEADA:
--     as linhas [0024] esperam deny_grant (interesses não persistem em
--     staging; o fluxo de interesses fica por validar).
--  3. Duas contas de teste de STAGING (A e B), sem app_metadata.role.
--     Os UUID não são segredos. Nunca usar contas de testers.
--
-- COMO CORRER: substituir os 4 valores marcados com <<< e executar o
-- ficheiro inteiro. Guardar a mensagem de erro final (o relatório).
--
-- Validado na simulação local PostgreSQL 17.11 (SEC-O-016B), incluindo a
-- prova de que nada persiste depois da execução.
--
-- LEITURA: cada linha = id | papel | esperado | obtido | PASS/FAIL.
--   rows=N      sucesso, N linhas afectadas/devolvidas
--   deny_grant  42501 por falta de privilégio (GRANT)
--   deny_rls    42501 por política RLS
--   deny        qualquer negação (grant, RLS, ou 0 linhas)
--   err:XXXXX   outro SQLSTATE (P0001 = trigger guard_activities_update)
-- ============================================================

do $main$
declare
  v_confirm text := 'NAO_CONFIRMADO';   -- <<< escrever: staging
  v_ref     text := 'NAO_CONFIRMADO';   -- <<< escrever o ref que aparece no URL do Dashboard
  v_user_a  uuid := null;               -- <<< UUID da conta de teste A (staging)
  v_user_b  uuid := null;               -- <<< UUID da conta de teste B (staging)
  v_cat uuid; v_ven uuid; v_par uuid; v_act uuid;
  v_dev text := 'sec-o-016-dev-' || substr(md5(random()::text), 1, 8);
  v_report text;
  v_fail int;
begin
  -- ---------- guardas ----------
  perform set_config('lock_timeout', '2s', true);
  perform set_config('statement_timeout', '30s', true);
  if v_confirm <> 'staging' then
    raise exception 'Abortado: confirmar o ambiente (v_confirm = staging) depois de ver o ref no URL.';
  end if;
  if v_ref <> 'jvtcgomwbfojsttepcfc' then
    raise exception 'Abortado: v_ref não é o ref do staging. Se o URL mostra outro projecto, PARAR.';
  end if;
  if (select count(*) from auth.users) >= 20 then
    raise exception 'Abortado: auth.users tem 20 ou mais contas; isto não parece o staging.';
  end if;
  if v_user_a is null or v_user_b is null or v_user_a = v_user_b then
    raise exception 'Abortado: definir dois UUID distintos de contas de teste de staging.';
  end if;
  if (select count(*) from auth.users where id in (v_user_a, v_user_b)) <> 2 then
    raise exception 'Abortado: os UUID indicados não existem em auth.users deste projecto.';
  end if;
  if exists (select 1 from auth.users where id in (v_user_a, v_user_b)
             and raw_app_meta_data ->> 'role' is not null) then
    raise exception 'Abortado: contas de teste não podem ter app_metadata.role.';
  end if;

  -- ---------- infraestrutura temporária ----------
  create temp table t_results (
    seq serial, id text, papel text, esperado text, obtido text, ok boolean, msg text);

  create function pg_temp.t(p_id text, p_role text, p_sub uuid, p_sql text, p_expect text)
  returns void language plpgsql as $f$
  declare n bigint := 0; st text := 'OK'; m text := ''; got text; pass boolean;
  begin
    perform set_config('request.jwt.claims',
      case when p_role = 'anon' then json_build_object('role', 'anon')::text
           else json_build_object('role', 'authenticated', 'sub', p_sub,
                                  'aud', 'authenticated')::text end, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
    perform set_config('request.jwt.claim.role', p_role, true);
    execute format('set local role %I', p_role);
    begin
      execute p_sql;
      get diagnostics n = row_count;
    exception when others then
      st := sqlstate; m := sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', '', true);

    got := case when st = 'OK' then 'rows=' || n
                when st = '42501' and m ilike '%row-level security%' then 'deny_rls'
                when st = '42501' then 'deny_grant'
                else 'err:' || st end;
    pass := case p_expect
              when 'rows>=1' then st = 'OK' and n >= 1
              when 'deny'    then got in ('deny_grant', 'deny_rls', 'rows=0')
              else got = p_expect end;
    insert into t_results(id, papel, esperado, obtido, ok, msg)
      values (p_id, p_role, p_expect, got, pass, left(m, 140));
  end;
  $f$;

  -- ---------- fixtures sintéticas (como dono; desfeitas no fim) ----------
  insert into public.categories(key, emoji, label_pt, label_en)
    values ('sec-o-016-' || substr(md5(random()::text), 1, 8), 'T', 'Teste SEC-O-016', 'Test SEC-O-016')
    returning id into v_cat;
  insert into public.venues(name) values ('SEC-O-016 fixture venue') returning id into v_ven;
  insert into public.partners(name, active) values ('SEC-O-016 fixture partner', true) returning id into v_par;
  insert into public.activities(title, venue_id, start_date, recurrence_type, interested_count)
    values ('SEC-O-016 fixture activity', v_ven, now() + interval '7 days', 'none', 5)
    returning id into v_act;
  insert into public.favorites(user_id, activity_id) values (v_user_b, v_act);
  insert into public.activity_interests(activity_id, user_id) values (v_act, v_user_b);

  -- ---------- anon: catálogo ----------
  perform pg_temp.t('A-01', 'anon', null, format('select 1 from public.categories where id = %L', v_cat), 'rows>=1');  -- [0023]
  perform pg_temp.t('A-02', 'anon', null, format('select 1 from public.venues where id = %L', v_ven), 'rows>=1');      -- [0023]
  perform pg_temp.t('A-03', 'anon', null, format('select 1 from public.partners where id = %L', v_par), 'rows>=1');    -- [0023]
  perform pg_temp.t('A-04', 'anon', null, format('select 1 from public.active_activities where id = %L', v_act), 'rows>=1');
  perform pg_temp.t('A-05', 'anon', null, format(
    'select a.id, v.name from public.active_activities a left join public.venues v on v.id = a.venue_id where a.id = %L', v_act),
    'rows>=1');                                                                                                         -- [0023] embed venues(...)
  perform pg_temp.t('A-06', 'anon', null, format('select 1 from public.activities where id = %L', v_act), 'rows>=1');

  -- ---------- anon: contador de interessados (trigger) ----------
  perform pg_temp.t('A-07', 'anon', null, format('update public.activities set interested_count = 6 where id = %L', v_act), 'rows=1');
  perform pg_temp.t('A-08', 'anon', null, format('update public.activities set interested_count = 20 where id = %L', v_act), 'err:P0001');
  perform pg_temp.t('A-09', 'anon', null, format('update public.activities set title = ''x'' where id = %L', v_act), 'err:P0001');
  perform pg_temp.t('A-10', 'anon', null, 'insert into public.activities(title) values (''SEC-O-016 nunca'')', 'deny_rls');
  perform pg_temp.t('A-11', 'anon', null, format('delete from public.activities where id = %L', v_act), 'deny');

  -- ---------- anon: interesses (0024 BLOQUEADA: nada concedido) ----------
  -- Requisitos reais do upsert: db/audit/local/activity-interests-requirements.local.sql
  perform pg_temp.t('A-12', 'anon', null, format(
    'insert into public.activity_interests(activity_id, user_id, device_id) values (%L, null, %L) '
    'on conflict (activity_id, device_id) do update set activity_id = excluded.activity_id, '
    'user_id = excluded.user_id, device_id = excluded.device_id', v_act, v_dev), 'deny_grant');                        -- [0024]
  perform pg_temp.t('A-14', 'anon', null, format(
    'insert into public.activity_interests(activity_id, user_id, device_id) values (%L, %L, null)', v_act, v_user_a), 'deny_grant');
  perform pg_temp.t('A-15', 'anon', null, format(
    'delete from public.activity_interests where activity_id = %L and device_id = %L', v_act, v_dev), 'deny_grant');
  perform pg_temp.t('A-16', 'anon', null, 'select user_id, device_id from public.activity_interests limit 1', 'deny_grant');  -- sem exposição
  perform pg_temp.t('A-17', 'anon', null, format(
    'update public.activity_interests set device_id = ''x'' where activity_id = %L', v_act), 'deny_grant');

  -- ---------- anon: sugestões ----------
  perform pg_temp.t('A-18', 'anon', null,
    'insert into public.suggestions(title, location, phone, comment, email, language) '
    'values (''SEC-O-016'', ''x'', ''x'', null, null, ''pt'')', 'rows=1');                                             -- [0023]
  perform pg_temp.t('A-19', 'anon', null,
    'insert into public.suggestions(title, status) values (''SEC-O-016'', ''approved'')', 'deny_grant');
  perform pg_temp.t('A-20', 'anon', null,
    'insert into public.suggestions(title) values (''   '')', 'deny_rls');                                               -- [0023]
  perform pg_temp.t('A-21', 'anon', null, 'select 1 from public.suggestions limit 1', 'deny_grant');

  -- ---------- anon: negativos ----------
  perform pg_temp.t('A-22', 'anon', null, 'select 1 from public.favorites limit 1', 'deny_grant');
  perform pg_temp.t('A-23', 'anon', null, format(
    'insert into public.favorites(user_id, activity_id) values (%L, %L)', v_user_a, v_act), 'deny_grant');
  perform pg_temp.t('A-24', 'anon', null, 'select 1 from public.users limit 1', 'deny_grant');
  perform pg_temp.t('A-25', 'anon', null, 'insert into public.categories(key, emoji, label_pt, label_en) values (''x'',''x'',''x'',''x'')', 'deny_grant');
  perform pg_temp.t('A-26', 'anon', null, format('update public.venues set name = ''x'' where id = %L', v_ven), 'deny_grant');
  perform pg_temp.t('A-27', 'anon', null, format('delete from public.partners where id = %L', v_par), 'deny_grant');
  perform pg_temp.t('A-28', 'anon', null, 'select 1 from staging.ingestion_runs limit 1', 'deny_grant');
  perform pg_temp.t('A-29', 'anon', null, 'select 1 from public.products limit 1', 'deny');      -- RLS sem políticas (0022)
  perform pg_temp.t('A-30', 'anon', null, 'insert into public.active_activities(title) values (''SEC-O-016 nunca'')', 'deny');
  perform pg_temp.t('A-31', 'anon', null, format('delete from public.active_activities where id = %L', v_act), 'deny');

  -- ---------- authenticated (conta A): favoritos ----------
  perform pg_temp.t('U-01', 'authenticated', v_user_a, format(
    'insert into public.favorites(user_id, activity_id) values (%L, %L)', v_user_a, v_act), 'rows=1');                 -- [0023]
  perform pg_temp.t('U-02', 'authenticated', v_user_a, format(
    'select activity_id from public.favorites where user_id = %L', v_user_a), 'rows>=1');                              -- [0023]
  perform pg_temp.t('U-03', 'authenticated', v_user_a, format(
    'select f.id, a.title, v.name from public.favorites f join public.activities a on a.id = f.activity_id '
    'left join public.venues v on v.id = a.venue_id where f.user_id = %L', v_user_a), 'rows>=1');                     -- [0023] embed do FavoritesScreen
  perform pg_temp.t('U-04', 'authenticated', v_user_a, format(
    'select 1 from public.favorites where user_id = %L', v_user_b), 'rows=0');
  perform pg_temp.t('U-05', 'authenticated', v_user_a, format(
    'insert into public.favorites(user_id, activity_id) values (%L, %L)', v_user_b, v_act), 'deny_rls');
  perform pg_temp.t('U-06', 'authenticated', v_user_a, format(
    'delete from public.favorites where user_id = %L and activity_id = %L', v_user_b, v_act), 'rows=0');
  perform pg_temp.t('U-07', 'authenticated', v_user_a, format(
    'delete from public.favorites where user_id = %L and activity_id = %L', v_user_a, v_act), 'rows=1');              -- [0023]

  -- ---------- authenticated: interesses (0024 BLOQUEADA) ----------
  perform pg_temp.t('U-08', 'authenticated', v_user_a, format(
    'insert into public.activity_interests(activity_id, user_id, device_id) values (%L, %L, null) '
    'on conflict (activity_id, device_id) do update set activity_id = excluded.activity_id, '
    'user_id = excluded.user_id, device_id = excluded.device_id', v_act, v_user_a), 'deny_grant');                     -- [0024]
  perform pg_temp.t('U-11', 'authenticated', v_user_a, format(
    'delete from public.activity_interests where activity_id = %L and user_id = %L', v_act, v_user_a), 'deny_grant'); -- [0024]
  perform pg_temp.t('U-12', 'authenticated', v_user_a,
    'select user_id from public.activity_interests limit 1', 'deny_grant');                                            -- sem exposição

  -- ---------- authenticated: restantes ----------
  perform pg_temp.t('U-13', 'authenticated', v_user_a, format('select 1 from public.categories where id = %L', v_cat), 'rows>=1');  -- [0023]
  perform pg_temp.t('U-14', 'authenticated', v_user_a, format('select 1 from public.partners where id = %L', v_par), 'rows>=1');    -- [0023]
  perform pg_temp.t('U-15', 'authenticated', v_user_a,
    'insert into public.suggestions(title, location, phone, comment, email, language) '
    'values (''SEC-O-016'', ''x'', ''x'', null, ''teste@example.invalid'', ''pt'')', 'rows=1');                      -- [0023]
  perform pg_temp.t('U-16', 'authenticated', v_user_a, format(
    'update public.activities set interested_count = 6 where id = %L', v_act), 'rows=1');
  perform pg_temp.t('U-17', 'authenticated', v_user_a, format('update public.venues set name = ''x'' where id = %L', v_ven), 'deny_grant');
  perform pg_temp.t('U-18', 'authenticated', v_user_a, format('delete from public.categories where id = %L', v_cat), 'deny_grant');
  perform pg_temp.t('U-19', 'authenticated', v_user_a, 'select 1 from public.users limit 1', 'deny_grant');
  perform pg_temp.t('U-20', 'authenticated', v_user_a, 'select 1 from public.suggestions limit 1', 'deny_grant');
  perform pg_temp.t('U-21', 'authenticated', v_user_a, 'select 1 from staging.ingestion_runs limit 1', 'deny_grant');

  -- ---------- relatório + rollback ----------
  select count(*) filter (where not ok),
         string_agg(rpad(id, 6) || ' | ' || rpad(papel, 13) || ' | ' || rpad(esperado, 10) || ' | '
                    || rpad(obtido, 10) || ' | ' || case when ok then 'PASS' else 'FAIL  ' || coalesce(msg, '') end,
                    E'\n' order by seq)
    into v_fail, v_report
  from t_results;

  raise exception E'SEC-O-016B testes de acesso: % FAIL de % (ROLLBACK: nada foi gravado)\n%',
    v_fail, (select count(*) from t_results), v_report;
end;
$main$;
