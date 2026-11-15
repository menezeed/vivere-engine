-- ============================================================
-- scripts/staging/api_budget_config.seed.example.sql
--
-- EXEMPLO / PROPOSTA — PENDENTE DE APROVAÇÃO DO PO. NÃO APLICAR TAL
-- COMO ESTÁ.
--
-- Os valores dos tectos são decisão do PO (L5-BUDGET-DESENHO §4 e §6).
-- Os valores abaixo são a PROPOSTA conservadora do desenho:
--   google_places: mensal USD 10 (o valor actual de vivere-60-mais.ts),
--                  diário USD 2, por execução USD 1, hard_stop ligado.
--
-- Pré-requisito: migração 0028 aplicada (no STAGING primeiro).
-- Quem aplica: só o operador/PO, pelo SQL Editor, com REF próprio. O
-- Engine nunca escreve nesta tabela (service_role só tem SELECT).
-- updated_by: identificador operacional, nunca um e-mail nem um nome.
--
-- Sem linha para um fornecedor, o Engine em --budget=persistent RECUSA
-- todas as chamadas pagas desse fornecedor (fail-closed).
--
-- Para aplicar depois da aprovação: rever os valores, trocar
-- v_aprovado para 'APROVADO_PELO_PO' e preencher v_updated_by.
-- ============================================================

do $seed$
declare
  v_aprovado   text := 'PROPOSTA';  -- <<< trocar para APROVADO_PELO_PO depois da decisão
  v_updated_by text := '';          -- <<< identificador operacional (sem e-mail)
begin
  if v_aprovado <> 'APROVADO_PELO_PO' then
    raise exception 'Abortado: valores ainda em PROPOSTA (decisão do PO pendente).';
  end if;
  if btrim(v_updated_by) = '' or v_updated_by ~ '@' then
    raise exception 'Abortado: v_updated_by tem de ser um identificador operacional (sem e-mail).';
  end if;

  insert into staging.api_budget_config
    (provider, monthly_budget_usd, daily_budget_usd, per_run_budget_usd, hard_stop_enabled, alert_thresholds_pct, updated_by)
  values
    ('google_places', 10.00, 2.00, 1.00, true, '{0.5,0.8,1.0}', v_updated_by);
end;
$seed$;
