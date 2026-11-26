-- ============================================================================
-- Piloto UK — fontes de CURADORIA manual (26/11/2026). SÓ STAGING.
-- ============================================================================
-- Porquê: staging.ingestion_runs.source_key tem FK para public.sources; o
-- script scripts/ingest-curated.ts falha sem estas linhas (nada é gravado).
--
-- O que faz: só INSERT (ON CONFLICT DO NOTHING) de 2 fontes do produto
-- vivere-60-plus-uk-test (activity_authority, prioridade 60):
--   greenwood_hhhvc            Hampton & Hampton Hill Voluntary Care (Greenwood)
--   richmond_good_neighbours   Richmond Good Neighbours
-- Não altera nem apaga linhas. Não é uma migração (sem DDL).
--
-- Guardas: v_confirm = 'staging' E o marcador do staging (primeira run u3a
-- do piloto, id e hora exactos), E o produto do piloto.
--
-- Uso (SQL Editor do STAGING):
--   1. v_confirm := 'staging'; correr com v_aplicar := false (simulação, desfaz).
--   2. v_aplicar := true e correr outra vez.
-- Reverter (só sem runs/raw das fontes — a FK impede o contrário):
--   delete from public.sources where source_key in ('greenwood_hhhvc','richmond_good_neighbours');
-- ============================================================================
do $fontes_curadoria$
declare
  v_confirm text    := '__AMBIENTE__';
  v_aplicar boolean := false;
  n_src int;
begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging (confirmar o projecto no URL do Dashboard)';
  end if;
  if not exists (
    select 1 from staging.ingestion_runs r
    where r.id = 'd2fcdb9e-bb12-4cd3-8bda-f92836d4ee90'
      and r.source_key = 'u3a_richmond'
      and r.started_at = '2026-11-26 10:25:06.953671+00'
  ) then
    raise exception 'RECUSA: marcador do staging ausente — este não é o projecto de staging do piloto UK';
  end if;
  if not exists (select 1 from public.products p where p.product_key in ('vivere-60-plus-uk-test')) then
    raise exception 'RECUSA: produto do piloto UK não existe neste projecto';
  end if;

  insert into public.sources (source_key, display_name, product_key, source_priority, source_kind)
  values
    ('greenwood_hhhvc', 'Hampton & Hampton Hill Voluntary Care (Greenwood)', 'vivere-60-plus-uk-test', 60, 'activity_authority'),
    ('richmond_good_neighbours', 'Richmond Good Neighbours', 'vivere-60-plus-uk-test', 60, 'activity_authority')
  on conflict (source_key) do nothing;
  get diagnostics n_src = row_count;

  if not v_aplicar then
    raise exception 'SIMULACAO (nada persistiu): % fonte(s) seria(m) inserida(s) — para aplicar, v_aplicar := true', n_src;
  end if;
  raise notice 'APLICADO: % fonte(s) inserida(s)', n_src;
end
$fontes_curadoria$;
