-- ============================================================================
-- Piloto UK (U4, 26/11/2026) — produto e fonte do piloto Richmond upon Thames
-- SÓ STAGING (public.products / public.sources do projecto de staging)
-- ============================================================================
-- Porquê: staging.ingestion_runs, raw_*_items e *_staging têm FKs para
-- public.sources(source_key) e public.products(product_key). A primeira
-- ingestão real da u3a (scripts/ingest-u3a.ts) falharia sem estas linhas.
--
-- O que faz: só INSERT (ON CONFLICT DO NOTHING) de
--   1 produto  vivere-60-plus-uk-test (is_active = false: piloto, não é um
--              produto activo; a publicação de produtos não-BR está bloqueada
--              no código até U8)
--   1 fonte    u3a_richmond (activity_authority, prioridade 90)
-- Não altera nem apaga nenhuma linha existente. Não é uma migração (sem DDL).
--
-- NUNCA correr na produção: recusa se o produto vivere-60-mais não existir com
-- o padrão do staging E exige v_confirm = 'staging' (confirmar o ref
-- jvtcgomwbfojsttepcfc no URL do Dashboard).
--
-- Uso (SQL Editor do STAGING):
--   1. v_confirm := 'staging'.
--   2. Correr com v_aplicar := false: mostra o que seria inserido e desfaz.
--   3. v_aplicar := true e correr outra vez.
-- Reverter (só se nenhuma ingestion_run/raw item usar a fonte — a FK impede o contrário):
--   delete from public.sources  where source_key  in ('u3a_richmond');
--   delete from public.products where product_key in ('vivere-60-plus-uk-test');
-- ============================================================================
do $piloto_uk$
declare
  v_confirm text    := '__AMBIENTE__';
  v_aplicar boolean := false;
  n_prod int;
  n_src  int;
begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging (confirmar o projecto no URL do Dashboard)';
  end if;
  if not exists (select 1 from public.products where product_key = 'vivere-60-mais') then
    raise exception 'RECUSA: produto vivere-60-mais não existe neste projecto';
  end if;

  insert into public.products (product_key, display_name, is_active)
  values ('vivere-60-plus-uk-test', 'Vivere 60+ UK (piloto Richmond — staging)', false)
  on conflict (product_key) do nothing;
  get diagnostics n_prod = row_count;

  insert into public.sources (source_key, display_name, product_key, source_priority, source_kind)
  values ('u3a_richmond', 'Richmond upon Thames u3a', 'vivere-60-plus-uk-test', 90, 'activity_authority')
  on conflict (source_key) do nothing;
  get diagnostics n_src = row_count;

  if not v_aplicar then
    raise exception 'SIMULACAO (nada persistiu): % produto(s) e % fonte(s) seriam inseridos — para aplicar, v_aplicar := true', n_prod, n_src;
  end if;
  raise notice 'APLICADO: % produto(s) e % fonte(s) inseridos', n_prod, n_src;
end
$piloto_uk$;
