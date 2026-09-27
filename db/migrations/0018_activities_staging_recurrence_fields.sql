-- ============================================================
-- Migration 0018 — staging.activities_staging recurrence fields
--
-- CONTEXTO (Activity 7/26 — Temporal / Recurrence Contract V1,
-- Activity 8/26 — Level 3 Schema Decision, 2026-09-26):
--
-- Adiciona 3 colunas tipadas a staging.activities_staging para guardar
-- a REGRA de recorrência estruturada, resultado do parsing de
-- raw_activity_items.recurrence_text_hint (texto bruto, nunca
-- interpretado na camada raw).
--
-- Mesmo contrato conceptual já usado em public.activities
-- (recurrence_type/recurrence_days/recurrence_time), preservado por
-- consistência directa — decisão explícita de Eduardo: colunas
-- tipadas, não um jsonb escondido.
--
-- occurrences[] (em raw_activity_items) continua reservado
-- exclusivamente para ocorrências CONCRETAS (date obrigatório) — esta
-- migration não o altera, e não introduz nenhum novo formato dentro
-- dele.
--
-- Aditiva, idempotente (IF NOT EXISTS), sem migração de dados: todas
-- as linhas existentes ficam com as 3 colunas NULL — comportamento
-- correcto, já que nenhuma linha existente foi parseada por um
-- parser de recorrência (ainda não existe até esta Activity).
--
-- Sem CHECK constraint em recurrence_type — decisão explícita de
-- Eduardo, para evitar acoplamento prematuro entre o schema e a
-- lista de valores suportados pelo app (none/daily/weekly/biweekly/
-- monthly), que pode evoluir sem exigir uma nova migration.
--
-- ROLLBACK: ver 0018_activities_staging_recurrence_fields.rollback.sql
-- ============================================================

ALTER TABLE staging.activities_staging
  ADD COLUMN IF NOT EXISTS recurrence_type  TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_days  INTEGER[],
  ADD COLUMN IF NOT EXISTS recurrence_time  TEXT;

COMMENT ON COLUMN staging.activities_staging.recurrence_type IS
  'Regra de recorrência estruturada, resultado do parsing de '
  'raw_activity_items.recurrence_text_hint. Valores esperados pelo '
  'app (Activity 7/26): none, daily, weekly, biweekly, monthly. '
  'NULL quando nenhuma recorrência foi detectada na fonte — '
  'equivalente semântico a ''none'', nunca escrito literalmente aqui '
  '(mesma convenção que activities_staging.venue_mention: ausência '
  'representada por NULL, não por um valor sentinela).';

COMMENT ON COLUMN staging.activities_staging.recurrence_days IS
  'Dias da semana aplicáveis à regra, inteiros 0-6 '
  '(convenção Date.getDay(): 0=domingo...6=sábado), mesma convenção '
  'já usada em public.activities.recurrence_days. NULL quando não '
  'aplicável ao recurrence_type (ex: daily, ou ausência de '
  'recorrência).';

COMMENT ON COLUMN staging.activities_staging.recurrence_time IS
  'Horário LOCAL (HH:MM, sem timezone resolvido nesta camada) de '
  'início da regra recorrente. NULL quando não publicado pela fonte '
  'ou não aplicável. Timezone é resolvido só no Publishing '
  '(Activity 9/26) — esta coluna guarda o valor tal como extraído do '
  'texto, sem conversão.';
