-- ============================================================================
-- Piloto UK — fonte Better (GLL) via OpenActive, Richmond (26/11/2026). SÓ STAGING.
-- ============================================================================
-- Porquê: staging.ingestion_runs e raw_activity_items têm FK para
-- public.sources(source_key). scripts/ingest-better.ts --apply falha sem esta linha.
--
-- O que faz: só INSERT (ON CONFLICT DO NOTHING) de 1 fonte
--   better_openactive_richmond (activity_authority, prioridade 70, produto
--   vivere-60-plus-uk-test, que já existe pelo seed piloto-uk-richmond).
-- Licença dos dados: CC BY 4.0 — atribuição "Better (GLL), OpenActive, CC BY 4.0".
-- Não altera nem apaga nenhuma linha. Não é uma migração (sem DDL).
--
-- NUNCA correr na produção: exige v_confirm = 'staging' (confirmar o ref
-- jvtcgomwbfojsttepcfc no URL do Dashboard), o marcador do staging e o
-- produto do piloto.
--
-- Uso (SQL Editor do STAGING):
--   1. v_confirm := 'staging'; correr com v_aplicar := false (simulação, desfaz).
--   2. v_aplicar := true e correr outra vez.
-- Reverter (só se nenhuma ingestion_run/raw item usar a fonte — a FK impede o contrário):
--   delete from public.sources where source_key = 'better_openactive_richmond';
-- ============================================================================
do $fonte_better$
declare
  v_confirm text    := '__AMBIENTE__';
  v_aplicar boolean := false;
  n_src int;
begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging (confirmar o projecto no URL do Dashboard)';
  end if;
  -- Marcador do staging: a primeira run da u3a do piloto, que só existe neste projecto.
  if not exists (
    select 1 from staging.ingestion_runs r
    where r.id = 'd2fcdb9e-bb12-4cd3-8bda-f92836d4ee90'
      and r.source_key = 'u3a_richmond'
      and r.started_at = '2026-11-26 10:25:06.953671+00'
  ) then
    raise exception 'RECUSA: marcador do staging ausente — este não é o projecto de staging do piloto UK';
  end if;
  if not exists (select 1 from public.products p where p.product_key in ('vivere-60-plus-uk-test')) then
    raise exception 'RECUSA: produto vivere-60-plus-uk-test não existe neste projecto';
  end if;

  insert into public.sources (source_key, display_name, product_key, source_priority, source_kind)
  values ('better_openactive_richmond', 'Better (GLL) — OpenActive, Richmond', 'vivere-60-plus-uk-test', 70, 'activity_authority')
  on conflict (source_key) do nothing;
  get diagnostics n_src = row_count;

  if not v_aplicar then
    raise exception 'SIMULACAO (nada persistiu): % fonte(s) seria(m) inserida(s) — para aplicar, v_aplicar := true', n_src;
  end if;
  raise notice 'APLICADO: % fonte(s) inserida(s)', n_src;
end
$fonte_better$;
