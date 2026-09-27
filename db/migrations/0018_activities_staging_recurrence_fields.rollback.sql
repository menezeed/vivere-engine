-- ============================================================
-- Rollback 0018 — remover recurrence fields de staging.activities_staging
--
-- Destrói somente dados gerados pelo parser de recorrência nestas 3
-- colunas — não afecta raw_activity_items (evidência bruta,
-- occurrences[], recurrence_text_hint permanecem intocados).
-- ============================================================

ALTER TABLE staging.activities_staging
  DROP COLUMN IF EXISTS recurrence_type,
  DROP COLUMN IF EXISTS recurrence_days,
  DROP COLUMN IF EXISTS recurrence_time;
