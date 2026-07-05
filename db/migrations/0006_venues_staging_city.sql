-- ============================================================
-- Migration 0006 — Coluna city persistida em venues_staging
--
-- CONTEXTO:
-- A cidade era anteriormente derivada do endereço por parsing
-- na camada de repositório (função extractCity). Isso é frágil,
-- não indexável, e viola o princípio de que cidade é um atributo
-- do dado, não uma interpretação da interface.
--
-- DECISÃO:
-- Adicionar coluna city persistida em venues_staging, preenchida
-- durante a ingestão a partir de source_query_text (que já contém
-- "teatro em Cabo Frio RJ" — a cidade está explícita na query).
-- Isso é mais fiável do que parsear o endereço retornado pelo Google.
--
-- ÍNDICE:
-- Índice em (product_key, city) para suportar filtros eficientes
-- em queries como ?city=Cabo+Frio&product_key=vivere-60-mais
-- sem full table scan.
--
-- MIGRATION DE DADOS:
-- Não há dados históricos para migrar — a coluna começa NULL para
-- registos existentes. O preenchimento retroactivo pode ser feito
-- manualmente ou pela próxima ingestão.
-- ============================================================

ALTER TABLE staging.venues_staging
  ADD COLUMN IF NOT EXISTS city text;

CREATE INDEX IF NOT EXISTS venues_staging_product_city_idx
  ON staging.venues_staging (product_key, city)
  WHERE city IS NOT NULL;

COMMENT ON COLUMN staging.venues_staging.city IS
  'Cidade do venue, persistida durante a ingestão a partir da região
   configurada no Collector. Não derivada do endereço retornado pela
   API para evitar dependência de parsing frágil.';
