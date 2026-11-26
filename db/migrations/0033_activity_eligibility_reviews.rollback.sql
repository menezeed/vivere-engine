-- ============================================================
-- Rollback da 0033 — remove a tabela de revisões humanas de elegibilidade.
-- Só staging. Não afecta activities_staging nem qualquer outra tabela.
--
-- Protecção da trilha de auditoria: se a tabela tiver revisões, RECUSA,
-- a menos que v_apagar_revisoes := true (decisão explícita do PO).
-- Exportar antes, se for o caso:
--   select * from staging.activity_eligibility_reviews order by reviewed_at;
-- ============================================================
do $rollback_0033$
declare
  v_apagar_revisoes boolean := false;
  n bigint := 0;
begin
  if not exists (
    select 1 from staging.ingestion_runs r
    where r.id = 'd2fcdb9e-bb12-4cd3-8bda-f92836d4ee90'
      and r.source_key = 'u3a_richmond'
      and r.started_at = '2026-11-26 10:25:06.953671+00'
  ) then
    raise exception 'RECUSA: marcador do staging ausente — este não é o projecto de staging do piloto UK';
  end if;
  if to_regclass('staging.activity_eligibility_reviews') is null then
    raise notice 'Nada a reverter: a tabela não existe';
    return;
  end if;
  execute 'select count(*) from staging.activity_eligibility_reviews' into n;
  if n > 0 and not v_apagar_revisoes then
    raise exception 'RECUSA: a tabela tem % revisão(ões); exportar e só então v_apagar_revisoes := true', n;
  end if;
  execute 'drop table staging.activity_eligibility_reviews';
  raise notice 'REVERTIDO: tabela removida (% revisão(ões) apagada(s))', n;
end
$rollback_0033$;
