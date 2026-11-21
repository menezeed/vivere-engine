-- ============================================================
-- Rollback 0028 — orçamento persistente das APIs pagas
--
-- AVISO: APAGA o histórico de gasto (staging.api_usage_log) e a
-- configuração dos tectos (staging.api_budget_config). Exportar as duas
-- tabelas antes, se o histórico for preciso. Só com REF próprio.
--
-- Depois do rollback, os scripts ingest-* com --budget=persistent
-- passam a falhar ao reservar (a RPC deixa de existir) e, por isso, a
-- RECUSAR todas as chamadas pagas (fail-closed). O modo por omissão
-- (em memória) não é afectado.
--
-- DROP TABLE não dispara os triggers de DELETE/TRUNCATE do
-- api_usage_log. Correr como `postgres`.
-- ============================================================

begin;

drop function staging.reserve_api_budget(text, text, uuid, uuid, numeric);
drop function staging.confirm_api_spend(bigint);
drop function staging.release_api_budget(bigint);

drop table staging.api_usage_log;
drop table staging.api_budget_config;

drop function staging.guard_api_usage_log();

commit;
