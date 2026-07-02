-- ============================================================
-- Migration 0003 — Constraints de idempotência em staging
--
-- Adiciona UNIQUE(raw_venue_item_id) em venues_staging e
-- UNIQUE(raw_activity_item_id) em activities_staging.
--
-- POR QUE MIGRATION SEPARADA:
-- Essas constraints não foram incluídas na 0001 porque a necessidade
-- só ficou clara ao desenhar a camada Repository (Fase 3). Uma linha
-- em venues_staging não deveria existir mais de uma vez para o mesmo
-- raw_venue_item — é uma invariante de integridade que pertence ao
-- banco, não só ao código. Manter em migration separada preserva a
-- rastreabilidade da decisão (ver proposta de arquitetura da Fase 3).
--
-- IMPACTO:
-- Só pode ser aplicada em ambientes onde ainda não há linhas
-- duplicadas em venues_staging/activities_staging com o mesmo
-- raw_*_item_id. Em dev (banco recém-criado), é sempre seguro.
-- Em produção futura, verificar antes:
--   SELECT raw_venue_item_id, count(*) FROM staging.venues_staging
--   GROUP BY 1 HAVING count(*) > 1;
-- ============================================================

alter table staging.venues_staging
  add constraint venues_staging_raw_venue_item_id_unique
  unique (raw_venue_item_id);

alter table staging.activities_staging
  add constraint activities_staging_raw_activity_item_id_unique
  unique (raw_activity_item_id);
