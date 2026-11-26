-- ============================================================================
-- Rollback da fonte FiSH Neighbourhood Care (piloto UK). SÓ STAGING.
-- ============================================================================
-- Desfaz o que scripts/ingest-fish.ts --apply e o seed
-- scripts/staging/fonte-fish.staging.sql gravaram, sem tocar na u3a nem em
-- qualquer outra fonte ou produto.
--
-- Uso (SQL Editor do projecto STAGING; confirmar o ref jvtcgomwbfojsttepcfc no URL):
--   1. v_confirm := 'staging'.
--   2. Correr com v_aplicar := false (por omissão): mostra as contagens e termina
--      com RAISE EXCEPTION → NADA persiste (os DELETE são desfeitos).
--   3. Conferir as contagens. Só então v_aplicar := true e correr outra vez.
--   v_apagar_fonte := true remove também a linha em public.sources (por omissão
--   fica, para se poder repetir a ingestão sem novo seed).
--
-- Guardas (Codex r3, achados 1–3):
--   G0 destino: além de v_confirm, exige o MARCADOR do staging — a primeira run
--      da u3a do piloto (id e hora exactos, 26/11/2026), que só existe neste
--      projecto. A produção nunca teve o piloto UK.
--   G1 serialização: LOCK em ingestion_runs, raw_activity_items e
--      activities_staging (SHARE ROW EXCLUSIVE) até ao fim da transacção:
--      nenhuma ingestão abre run nem insere linhas, e nenhuma revisão altera
--      actividades enquanto o rollback avalia e apaga.
--   G2 âmbito: o alvo são só as actividades do produto vivere-60-plus-uk-test
--      com raw da fonte FiSH. Recusa se houver raw FiSH ligado a outro produto,
--      runs FiSH com venues, ou qualquer outra dependência fora do alvo.
-- Recusas de estado:
--   R1 actividade FiSH revista, aprovada, rejeitada ou promovida;
--   R2 candidatos/decisões de Entity Resolution sobre actividades FiSH;
--   R3 ingestion_run FiSH em 'running';
--   R4 venues com a fonte FiSH.
-- Os DELETE repetem as condições de R1 e comparam as contagens com as
-- avaliadas; qualquer diferença aborta tudo.
--
-- Ordem (FKs lidas do catálogo do staging a 26/11/2026):
--   activities_staging → raw_activity_items → ingestion_runs → (sources)
-- ============================================================================
do $fish_rollback$
declare
  v_confirm      text    := '__AMBIENTE__';
  v_aplicar      boolean := false;
  v_apagar_fonte boolean := false;
  k  constant text := 'fish_neighbourhood_care';
  pk constant text := 'vivere-60-plus-uk-test';
  e_act int; e_raw int; e_run int;
  n_act int; n_raw int; n_run int; n_src int := 0;
begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging (confirmar o projecto no URL do Dashboard)';
  end if;
  -- G0: marcador do staging
  if not exists (
    select 1 from staging.ingestion_runs r
    where r.id = 'd2fcdb9e-bb12-4cd3-8bda-f92836d4ee90'
      and r.source_key = 'u3a_richmond'
      and r.started_at = '2026-11-26 10:25:06.953671+00'
  ) then
    raise exception 'RECUSA G0: marcador do staging ausente — este não é o projecto de staging do piloto UK';
  end if;

  -- G1: serializa com ingestões e revisões até ao fim da transacção
  lock table staging.ingestion_runs, staging.raw_activity_items, staging.activities_staging in share row exclusive mode;

  -- R3
  if exists (select 1 from staging.ingestion_runs r where r.source_key = k and r.status = 'running') then
    raise exception 'RECUSA R3: há um ingestion_run FiSH em running';
  end if;

  -- G2: raw FiSH ligado a outro produto → fora do âmbito
  if exists (
    select 1 from staging.activities_staging a
    join staging.raw_activity_items r on r.id = a.raw_activity_item_id
    where r.source_key = k and a.product_key <> pk
  ) then
    raise exception 'RECUSA G2: há actividades da fonte FiSH noutro produto';
  end if;

  -- R1
  if exists (
    select 1 from staging.activities_staging a
    join staging.raw_activity_items r on r.id = a.raw_activity_item_id
    where r.source_key = k and a.product_key = pk
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

  -- R4 / G2: venues da fonte, ou runs FiSH com venues
  if exists (select 1 from staging.raw_venue_items v where v.source_key = k)
     or exists (select 1 from staging.venues_staging v where v.source_key = k)
     or exists (select 1 from staging.raw_venue_items v join staging.ingestion_runs r on r.id = v.ingestion_run_id where r.source_key = k) then
    raise exception 'RECUSA R4: há venues ligados à fonte FiSH (ingest-fish.ts não cria venues)';
  end if;

  -- G2: runs FiSH com raw de OUTRA fonte (não deveria acontecer)
  if exists (select 1 from staging.raw_activity_items x join staging.ingestion_runs r on r.id = x.ingestion_run_id where r.source_key = k and x.source_key <> k) then
    raise exception 'RECUSA G2: há runs FiSH com items de outra fonte';
  end if;

  -- Contagens avaliadas (com as tabelas bloqueadas)
  select count(*) into e_act from staging.activities_staging a
    join staging.raw_activity_items r on r.id = a.raw_activity_item_id
    where r.source_key = k and a.product_key = pk;
  select count(*) into e_raw from staging.raw_activity_items r where r.source_key = k;
  select count(*) into e_run from staging.ingestion_runs r where r.source_key = k;

  delete from staging.activities_staging a
  using staging.raw_activity_items r
  where r.id = a.raw_activity_item_id and r.source_key = k and a.product_key = pk
    and a.proposal_status = 'pending_review' and a.reviewed_by is null and a.promoted_activity_id is null;
  get diagnostics n_act = row_count;

  delete from staging.raw_activity_items r where r.source_key = k;
  get diagnostics n_raw = row_count;

  delete from staging.ingestion_runs r where r.source_key = k;
  get diagnostics n_run = row_count;

  if (n_act, n_raw, n_run) is distinct from (e_act, e_raw, e_run) then
    raise exception 'RECUSA: contagens apagadas (%/%/%) diferentes das avaliadas (%/%/%) — nada persiste', n_act, n_raw, n_run, e_act, e_raw, e_run;
  end if;

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
