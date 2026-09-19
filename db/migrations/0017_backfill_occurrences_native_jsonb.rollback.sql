-- ============================================================
-- Rollback da Migration 0017 — occurrences volta a string serializada
--
-- NOTA: isto reverte a FORMA (array jsonb → string JSON dentro de jsonb),
-- não "desfaz" nenhuma perda de dados — a migration 0017 não perde dados,
-- apenas reformata. Este rollback existe por convenção (par obrigatório
-- de cada migration), mas na prática só deve ser necessário se o parser
-- tolerante de PublishableActivityRepository for removido antes de se
-- confirmar que todos os consumidores lêem array nativo correctamente.
--
-- Idempotente: só re-serializa linhas onde jsonb_typeof = 'array'.
-- ============================================================

UPDATE staging.raw_activity_items
SET occurrences = to_jsonb(occurrences::text)
WHERE jsonb_typeof(occurrences) = 'array';
