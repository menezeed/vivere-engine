-- ============================================================================
-- Fontes de Lagos em falta no STAGING (public.sources) — SÓ STAGING
-- ============================================================================
-- Porquê: a 15/11/2026, public.sources no staging tem prefeitura_cabo_frio,
-- prefeitura_iguaba_grande, prefeitura_sao_pedro_da_aldeia e google_places,
-- mas NÃO prefeitura_rio_das_ostras nem prefeitura_buzios (fontes do PR #8).
-- staging.ingestion_runs.source_key referencia public.sources: a primeira
-- ingestão real dessas regiões falharia na FK.
--
-- O que faz: só INSERT das fontes em falta, com os mesmos valores das
-- configs do engine e de prefeitura_cabo_frio (activity_authority, prioridade
-- 100). Não altera nem apaga nenhuma linha existente (ON CONFLICT DO NOTHING).
--
-- Uso (SQL Editor do STAGING, confirmar o ref no URL):
--   1. v_confirm := 'staging'.
--   2. Correr com v_aplicar := false: mostra quantas seriam inseridas e desfaz.
--   3. v_aplicar := true e correr outra vez.
-- Reverter: delete from public.sources where source_key in (...) — só se
-- nenhuma ingestion_run as usar ainda (a FK impede o contrário).
-- ============================================================================
do $fontes$
declare
  v_confirm text    := '__AMBIENTE__';
  v_aplicar boolean := false;
  n_ins int;
begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging (confirmar o projecto no URL do Dashboard)';
  end if;
  if not exists (select 1 from public.products where product_key = 'vivere-60-mais') then
    raise exception 'RECUSA: produto vivere-60-mais não existe neste projecto';
  end if;

  insert into public.sources (source_key, display_name, product_key, source_priority, source_kind)
  values
    ('prefeitura_rio_das_ostras', 'Prefeitura de Rio das Ostras',            'vivere-60-mais', 100, 'activity_authority'),
    ('prefeitura_buzios',         'Prefeitura de Armação dos Búzios',        'vivere-60-mais', 100, 'activity_authority')
  on conflict (source_key) do nothing;
  get diagnostics n_ins = row_count;

  if not v_aplicar then
    raise exception 'SIMULACAO (nada persistiu): % fonte(s) seriam inseridas — para aplicar, v_aplicar := true', n_ins;
  end if;
  raise notice 'APLICADO: % fonte(s) inseridas', n_ins;
end
$fontes$;
