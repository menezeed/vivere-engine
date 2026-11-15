-- ============================================================================
-- Venue CURADO manualmente (local real, morada e coordenadas verificadas) — SÓ STAGING
-- ============================================================================
-- Porquê: o primeiro fluxo real de Cabo Frio tem 1 actividade futura (6.ª
-- Corrida da Virada, 31/12/2026 06:00). O gate G2 só publica actividades com
-- venue público com coordenadas, e não há venues no staging. O PO decidiu
-- (15/11) evitar custos externos nesta primeira execução: o local é
-- identificado e verificado manualmente, sem Google Places.
--
-- Local (fonte oficial): post da Prefeitura de Cabo Frio de 26/10/2026,
--   https://noticias.cabofrio.rj.gov.br/inscricoes-abertas-para-a-6a-corrida-da-virada-de-cabo-frio/
--   "A largada acontece dia 31 de dezembro, às 6h, na Av. Quatro Estações,
--    no Novo Portinho".
-- Coordenadas candidatas: OpenStreetMap, way 289799074 ("Avenida Quatro
--   Estacoes", CEP 28911-320): -22.8739787, -42.0306703 (centróide da via).
--   https://www.openstreetmap.org/way/289799074
--   O PO confirma no mapa antes de aplicar (v_coords_verificadas).
-- Nome "Novo Portinho": é como o post designa o local e casa com a menção
--   extraída (NameMatcher = 1,0 → candidato 'matched' para revisão humana).
--
-- O que cria (nada existente é alterado):
--   public.sources            'curadoria_manual' (venue_authority), se faltar
--   staging.ingestion_runs     1 run 'success' da curadoria (proveniência)
--   staging.raw_venue_items    1 linha com nome, morada, lat/lng e proveniência
--   staging.venues_staging     1 linha proposal_status por omissão (pending_review):
--                              o PO aprova e promove na Review API (admin).
--
-- Uso: v_confirm := 'staging'; v_coords_verificadas := true SÓ depois de
-- abrir o link OSM e confirmar o ponto; v_verificado_por := 'PO' (sem nomes).
-- Correr com v_aplicar := false (simulação), depois true.
-- Reverter: v_reverter := true (apaga só as linhas desta curadoria; recusa se
-- o venue já tiver sido promovido para public.venues ou tiver candidatos ER).
-- ============================================================================
do $venue$
declare
  v_confirm            text    := '__AMBIENTE__';
  v_aplicar            boolean := false;
  v_reverter           boolean := false;
  v_coords_verificadas boolean := false;
  v_verificado_por     text    := 'PO';

  -- Dados do local (curadoria 15/11/2026)
  c_item_id  constant text := 'curadoria:osm-way-289799074:corrida-virada-largada';
  c_nome     constant text := 'Novo Portinho';
  c_morada   constant text := 'Av. Quatro Estações, Novo Portinho, Cabo Frio - RJ, 28911-320';
  c_cidade   constant text := 'Cabo Frio';
  c_lat      constant double precision := -22.8739787;
  c_lng      constant double precision := -42.0306703;

  v_run uuid; v_raw uuid; v_ven uuid; v_prom uuid; n_cand int;
begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging (confirmar o projecto no URL do Dashboard)';
  end if;

  if v_reverter then
    select id, promoted_venue_id into v_ven, v_prom from staging.venues_staging
      where source_key = 'curadoria_manual' and source_item_id = c_item_id for update;
    if not found then raise exception 'RECUSA: venue curado não existe'; end if;
    if v_prom is not null then raise exception 'RECUSA: venue já promovido para public.venues — arquivar pelo publishing'; end if;
    select count(*) into n_cand from staging.venue_resolution_candidates where candidate_venue_id = v_ven;
    if n_cand > 0 then raise exception 'RECUSA: % candidatos ER apontam para este venue', n_cand; end if;
    select raw_venue_item_id into v_raw from staging.venues_staging where id = v_ven;
    select ingestion_run_id into v_run from staging.raw_venue_items where id = v_raw;
    delete from staging.venues_staging  where id = v_ven;
    delete from staging.raw_venue_items where id = v_raw;
    delete from staging.ingestion_runs  where id = v_run
      and not exists (select 1 from staging.raw_venue_items where ingestion_run_id = v_run)
      and not exists (select 1 from staging.raw_activity_items where ingestion_run_id = v_run);
    if not v_aplicar then raise exception 'SIMULACAO (nada persistiu): reversão apagaria 1 venue, 1 raw e a run da curadoria'; end if;
    raise notice 'REVERTIDO: venue curado removido';
    return;
  end if;

  if not v_coords_verificadas then
    raise exception 'RECUSA: confirmar as coordenadas no mapa (link OSM no cabeçalho) e pôr v_coords_verificadas := true';
  end if;
  if c_lat not between -23.1 and -22.5 or c_lng not between -42.4 and -41.8 then
    raise exception 'RECUSA: coordenadas fora da Região dos Lagos';
  end if;
  if exists (select 1 from staging.venues_staging where source_key = 'curadoria_manual' and source_item_id = c_item_id) then
    raise exception 'RECUSA: este venue curado já existe (nada a fazer)';
  end if;
  if not exists (select 1 from public.products where product_key = 'vivere-60-mais') then
    raise exception 'RECUSA: produto vivere-60-mais não existe neste projecto';
  end if;

  insert into public.sources (source_key, display_name, product_key, source_priority, source_kind)
  values ('curadoria_manual', 'Curadoria manual (locais verificados)', 'vivere-60-mais', 90, 'venue_authority')
  on conflict (source_key) do nothing;

  insert into staging.ingestion_runs (source_key, status, finished_at, items_collected)
  values ('curadoria_manual', 'success', now(), 1) returning id into v_run;

  insert into staging.raw_venue_items (ingestion_run_id, source_key, source_item_id, collected_at,
                                       name, address, lat, lng, source_region_label, raw_payload)
  values (v_run, 'curadoria_manual', c_item_id, now(), c_nome, c_morada, c_lat, c_lng, 'Cabo Frio',
          jsonb_build_object(
            'proveniencia', 'curadoria_manual',
            'coordenadas_fonte', 'openstreetmap way/289799074 (centróide da via)',
            'evento_fonte', 'https://noticias.cabofrio.rj.gov.br/inscricoes-abertas-para-a-6a-corrida-da-virada-de-cabo-frio/',
            'verificado_por', v_verificado_por,
            'verificado_em', now()))
  returning id into v_raw;

  insert into staging.venues_staging (raw_venue_item_id, product_key, source_key, source_item_id, city, name)
  values (v_raw, 'vivere-60-mais', 'curadoria_manual', c_item_id, c_cidade, c_nome)
  returning id into v_ven;

  if not v_aplicar then
    raise exception 'SIMULACAO (nada persistiu): criaria run %, raw %, venue % (pending_review) — para aplicar, v_aplicar := true', v_run, v_raw, v_ven;
  end if;
  raise notice 'APLICADO: venue_staging % (pending_review) — aprovar e promover na Review API', v_ven;
end
$venue$;
