-- ============================================================
-- Migration 0007 — Coluna name persistida em venues_staging
--
-- PROBLEMA RESOLVIDO:
-- A busca por nome era feita client-side no repositório após fetch,
-- o que significa que com pageSize=20, a pesquisa filtrava apenas
-- os 20 resultados da página corrente — não os 160+ venues totais.
-- Em produção com 10.000 venues, a pesquisa seria completamente
-- inútil.
--
-- SOLUÇÃO:
-- Persistir o nome do venue directamente em venues_staging, tal
-- como fizemos com a coluna city (migration 0006). O nome vem de
-- raw_venue_items.name via JOIN e é copiado no momento do insert
-- pelo VenueStagingRepository.
--
-- ÍNDICE:
-- GIN trigram index em name para suportar ILIKE '%termo%' eficiente.
-- Sem este índice, ILIKE faz full table scan em cada pesquisa.
-- Com 10.000 venues, a diferença é de segundos para milissegundos.
--
-- EXTENSÃO pg_trgm:
-- Necessária para o índice GIN trigram. Já disponível no Supabase
-- por defeito (não requer instalação adicional).
--
-- MIGRAÇÃO DE DADOS:
-- Popular a coluna para os registos existentes a partir de
-- raw_venue_items.name via JOIN.
-- ============================================================

-- Activar extensão trigram (idempotente — já existe no Supabase)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Adicionar coluna name
ALTER TABLE staging.venues_staging
  ADD COLUMN IF NOT EXISTS name text;

-- Popular registos existentes
UPDATE staging.venues_staging vs
SET name = (
  SELECT r.name
  FROM staging.raw_venue_items r
  WHERE r.id = vs.raw_venue_item_id
)
WHERE name IS NULL;

-- Índice GIN trigram para ILIKE eficiente
CREATE INDEX IF NOT EXISTS venues_staging_name_trgm_idx
  ON staging.venues_staging
  USING gin (name gin_trgm_ops)
  WHERE name IS NOT NULL;

-- Índice composto para listagens filtradas por produto + status (sem WHERE partial)
-- Cobre os tabs "Aprovados", "Rejeitados", "Promovidos" que não têm índice actual
CREATE INDEX IF NOT EXISTS venues_staging_product_status_idx
  ON staging.venues_staging (product_key, proposal_status, created_at DESC);

-- Índice para filtro por fonte (source_key)
CREATE INDEX IF NOT EXISTS venues_staging_source_key_idx
  ON staging.venues_staging (source_key);

COMMENT ON COLUMN staging.venues_staging.name IS
  'Nome do venue, persistido durante a ingestão a partir de raw_venue_items.name.
   Permite busca server-side eficiente via índice GIN trigram sem JOIN.
   Mesmo princípio da coluna city (migration 0006).';
