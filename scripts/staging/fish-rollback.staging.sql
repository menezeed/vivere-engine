-- ============================================================================
-- Rollback da fonte FiSH Neighbourhood Care (piloto UK). SÓ STAGING.
-- ============================================================================
-- Desfaz tudo o que scripts/ingest-fish.ts --apply e o seed
-- scripts/staging/fonte-fish.staging.sql gravaram, sem tocar na u3a nem em
-- qualquer outra fonte, e sem tocar em production.
--
-- Uso (SQL Editor do projecto STAGING; confirmar o ref jvtcgomwbfojsttepcfc no URL):
--   1. v_confirm := 'staging'.
--   2. Correr com v_aplicar := false (por omissão): mostra as contagens e termina
--      com RAISE EXCEPTION → NADA persiste.
--   3. Conferir as contagens. Só então v_aplicar := true e correr outra vez.
--   v_apagar_fonte := true remove também a linha em public.sources (por omissão
--   fica, para se poder repetir a ingestão sem novo seed).
--
-- Recusa (nada é apagado) se:
--   R1 alguma actividade FiSH já não está em pending_review, foi revista
--      (reviewed_by) ou promovida (promoted_activity_id) — decisão humana:
--      falar com o PO primeiro;
--   R2 há candidatos ou decisões de Entity Resolution sobre actividades FiSH;
--   R3 há um ingestion_run FiSH em 'running' (bloqueia as linhas: FOR UPDATE);
--   R4 há venues FiSH (raw ou staging) — a ingestão FiSH não cria venues; se
--      existirem, vieram de outro processo.
--
-- Ordem (FKs lidas do catálogo do staging a 26/11/2026):
--   activities_staging → raw_activity_items → ingestion_runs → (sources)
-- ============================================================================
do $fish_rollback$
declare
  v_confirm      text    := '__AMBIENTE__';
  v_aplicar      boolean := false;
  v_apagar_fonte boolean := false;
  k constant text := 'fish_neighbourhood_care';
  n_act int; n_raw int; n_run int; n_src int := 0;
begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging (confirmar o projecto no URL do Dashboard)';
  end if;
  if not exists (select 1 from public.products p where p.product_key in ('vivere-60-plus-uk-test')) then
    raise exception 'RECUSA: produto do piloto UK não existe neste projecto';
  end if;

  -- R3 (com bloqueio das runs da fonte até ao fim da transacção)
  perform 1 from staging.ingestion_runs r where r.source_key = k for update;
  if exists (select 1 from staging.ingestion_runs r where r.source_key = k and r.status = 'running') then
    raise exception 'RECUSA R3: há um ingestion_run FiSH em running';
  end if;

  -- R1
  if exists (
    select 1 from staging.activities_staging a
    join staging.raw_activity_items r on r.id = a.raw_activity_item_id
    where r.source_key = k
      and (a.proposal_status <> 'pending_review' or a.reviewed_by is not null or a.promoted_activity_id is not null)
  ) then
    raise exception 'RECUSA R1: há actividades FiSH revistas, aprovadas, rejeitadas ou promovidas';
  end if;

  -- R2
  if exists (
    select 1 from staging.venue_resolution_candidates c
    join staging.activities_staging a on a.id = c.activity_staging_id
    join staging.raw_activity_items r on r.id = a.raw_activity_item_id
    where r.source_key = k
  ) or exists (
    select 1 from staging.venue_resolution_decisions d
    join staging.activities_staging a on a.id = d.activity_staging_id
    join staging.raw_activity_items r on r.id = a.raw_activity_item_id
    where r.source_key = k
  ) then
    raise exception 'RECUSA R2: há trabalho de Entity Resolution sobre actividades FiSH';
  end if;

  -- R4
  if exists (select 1 from staging.raw_venue_items v where v.source_key = k)
     or exists (select 1 from staging.venues_staging v where v.source_key = k) then
    raise exception 'RECUSA R4: há venues com a fonte FiSH (não criados por ingest-fish.ts)';
  end if;

  delete from staging.activities_staging a
  using staging.raw_activity_items r
  where r.id = a.raw_activity_item_id and r.source_key = k;
  get diagnostics n_act = row_count;

  delete from staging.raw_activity_items r where r.source_key = k;
  get diagnostics n_raw = row_count;

  delete from staging.ingestion_runs r where r.source_key = k;
  get diagnostics n_run = row_count;

  if v_apagar_fonte then
    delete from public.sources s where s.source_key = k;
    get diagnostics n_src = row_count;
  end if;

  if not v_aplicar then
    raise exception 'SIMULACAO (nada persistiu): activities_staging=% raw_activity_items=% ingestion_runs=% sources=%', n_act, n_raw, n_run, n_src;
  end if;
  raise notice 'APLICADO: activities_staging=% raw_activity_items=% ingestion_runs=% sources=%', n_act, n_raw, n_run, n_src;
end
$fish_rollback$;
