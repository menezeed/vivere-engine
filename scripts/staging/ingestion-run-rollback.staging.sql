-- ============================================================================
-- Rollback de UMA execução de ingestão (staging.ingestion_runs.id) — SÓ STAGING
-- ============================================================================
-- Para: primeira ingestão real assistida (runbook E4). Desfaz tudo o que essa
-- execução gravou no schema `staging`, sem tocar em public.* nem noutras runs.
--
-- Uso (SQL Editor do projecto STAGING; confirmar o ref no URL antes):
--   1. Substituir __RUN_ID__ pelo ingestion_run_id do manifesto da execução.
--   2. Substituir __AMBIENTE__ por staging  (qualquer outro valor → recusa).
--   3. Correr com v_aplicar := false (por omissão): mostra as contagens e
--      termina com RAISE EXCEPTION → NADA persiste.
--   4. Conferir as contagens. Só então mudar para v_aplicar := true e correr
--      outra vez: a mensagem final (NOTICE) traz as mesmas contagens.
--
-- Recusa (nada é apagado) se:
--   R1 a run não existe;
--   R2 alguma activity/venue da run já foi PROMOVIDA para public.* (usar o
--      arquivo do publishing, não este rollback);
--   R3 existe decisão humana de Entity Resolution sobre activities da run
--      (trabalho de revisão — decidir primeiro com o PO);
--   R4 activities ou candidatos de OUTRAS runs apontam para venues desta run;
--   R5 há registos de gasto (staging.api_usage_log, 0028) ligados à run — o
--      registo de gasto é só de acréscimo e não se apaga.
--
-- Ordem (grafo de FKs do staging lido do catálogo a 15/11/2026):
--   venue_resolution_candidates → activities_staging → venues_staging
--   → raw_activity_items / raw_venue_items → ingestion_runs.
-- venue_resolution_runs NÃO são apagadas (não pertencem a uma ingestão).
-- ============================================================================
do $rollback$
declare
  v_run       uuid    := '__RUN_ID__';
  v_confirm   text    := '__AMBIENTE__';
  v_aplicar   boolean := false;

  n_raw_a int; n_raw_v int; n_act int; n_ven int; n_cand int;
  n_prom_a int; n_prom_v int; n_dec int; n_ext int; n_usage int := 0;
  v_rel text;
begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging (confirmar o projecto no URL do Dashboard)';
  end if;

  perform 1 from staging.ingestion_runs where id = v_run;
  if not found then raise exception 'RECUSA R1: ingestion_run % não existe', v_run; end if;

  create temp table _rb_raw_a on commit drop as
    select id from staging.raw_activity_items where ingestion_run_id = v_run;
  create temp table _rb_raw_v on commit drop as
    select id from staging.raw_venue_items where ingestion_run_id = v_run;
  create temp table _rb_act on commit drop as
    select id, promoted_activity_id from staging.activities_staging
    where raw_activity_item_id in (select id from _rb_raw_a);
  create temp table _rb_ven on commit drop as
    select id, promoted_venue_id from staging.venues_staging
    where raw_venue_item_id in (select id from _rb_raw_v);

  select count(*) into n_raw_a from _rb_raw_a;
  select count(*) into n_raw_v from _rb_raw_v;
  select count(*) into n_act   from _rb_act;
  select count(*) into n_ven   from _rb_ven;
  select count(*) into n_prom_a from _rb_act where promoted_activity_id is not null;
  select count(*) into n_prom_v from _rb_ven where promoted_venue_id   is not null;
  select count(*) into n_dec from staging.venue_resolution_decisions
    where activity_staging_id in (select id from _rb_act);
  select (select count(*) from staging.activities_staging a
            where a.resolved_venue_staging_id in (select id from _rb_ven)
              and a.id not in (select id from _rb_act))
       + (select count(*) from staging.venue_resolution_candidates c
            where c.candidate_venue_id in (select id from _rb_ven)
              and c.activity_staging_id not in (select id from _rb_act))
    into n_ext;
  v_rel := pg_catalog.to_regclass('staging.api_usage_log')::text;
  if v_rel is not null then
    execute 'select count(*) from staging.api_usage_log where ingestion_run_id = $1' into n_usage using v_run;
  end if;

  if n_prom_a > 0 or n_prom_v > 0 then
    raise exception 'RECUSA R2: % activities e % venues já promovidos para public.* — usar o arquivo do publishing', n_prom_a, n_prom_v;
  end if;
  if n_dec > 0 then
    raise exception 'RECUSA R3: % decisões humanas de Entity Resolution sobre activities desta run', n_dec;
  end if;
  if n_ext > 0 then
    raise exception 'RECUSA R4: % referências de outras runs a venues desta run', n_ext;
  end if;
  if n_usage > 0 then
    raise exception 'RECUSA R5: % registos de gasto (api_usage_log) ligados a esta run', n_usage;
  end if;

  delete from staging.venue_resolution_candidates
   where activity_staging_id in (select id from _rb_act)
      or candidate_venue_id  in (select id from _rb_ven);
  get diagnostics n_cand = row_count;
  delete from staging.activities_staging where id in (select id from _rb_act);
  delete from staging.venues_staging     where id in (select id from _rb_ven);
  delete from staging.raw_activity_items where id in (select id from _rb_raw_a);
  delete from staging.raw_venue_items    where id in (select id from _rb_raw_v);
  delete from staging.ingestion_runs     where id = v_run;

  if not v_aplicar then
    raise exception 'SIMULACAO (nada persistiu): run % | raw_activity_items % | raw_venue_items % | activities_staging % | venues_staging % | candidatos % — para aplicar, v_aplicar := true',
      v_run, n_raw_a, n_raw_v, n_act, n_ven, n_cand;
  end if;
  raise notice 'APLICADO: run % | raw_activity_items % | raw_venue_items % | activities_staging % | venues_staging % | candidatos %',
    v_run, n_raw_a, n_raw_v, n_act, n_ven, n_cand;
end
$rollback$;
