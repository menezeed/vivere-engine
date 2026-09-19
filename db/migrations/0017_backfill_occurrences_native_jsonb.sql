-- ============================================================
-- Migration 0017 — backfill occurrences para jsonb nativo
--
-- CONTEXTO (ADR-0020, Sprint 8.7):
-- raw_activity_items.occurrences foi persistido, por bug do Collector
-- de origem, como uma STRING JSON dentro da coluna jsonb (serialização
-- dupla — JSON.stringify() aplicado antes da escrita), em vez de um
-- array jsonb nativo. Confirmado em produção:
--   jsonb_typeof(occurrences) = 'string' em todas as 8 linhas existentes
--   (com_occurrences = 8, without_occurrences = 0, à data da validação).
--
-- Esta migration converte, in-place, apenas as linhas afectadas.
--
-- PRÉ-REQUISITOS:
-- 1. Collector/repositório de escrita corrigido para gravar array jsonb
--    nativo em novas linhas (fix separado, fora desta migration —
--    aplicar esta migration antes ou depois desse fix não é conflituante,
--    mas o fix do Collector deve ser aplicado antes de nova ingestão para
--    não reintroduzir o bug após o backfill).
-- 2. PublishableActivityRepository.parseOccurrences (parser tolerante,
--    Sprint 8.7) já em produção — aceita ambas as formas durante a janela
--    de transição, por isso esta migration não é bloqueante para publicar.
--
-- SEGURANÇA:
-- Actualiza APENAS linhas onde jsonb_typeof(occurrences) = 'string' —
-- idempotente (correr duas vezes não faz nada da segunda vez, porque após
-- a conversão jsonb_typeof passa a 'array' e a condição deixa de bater).
-- Se algum valor não for um array JSON válido, o cast falha e a migration
-- aborta inteira (transação) — nenhuma linha fica parcialmente convertida.
--
-- ROLLBACK: ver 0017_backfill_occurrences_native_jsonb.rollback.sql
-- (rollback re-serializa para string — reverte a forma, não recupera
-- eventuais erros de dados; ver nota no ficheiro de rollback)
-- ============================================================

DO $$
DECLARE
  affected_count INT;
BEGIN
  SELECT count(*) INTO affected_count
  FROM staging.raw_activity_items
  WHERE jsonb_typeof(occurrences) = 'string';

  RAISE NOTICE 'Linhas a converter (jsonb_typeof = string): %', affected_count;
END $$;

UPDATE staging.raw_activity_items
SET occurrences = (occurrences #>> '{}')::jsonb
WHERE jsonb_typeof(occurrences) = 'string';

DO $$
DECLARE
  remaining_count INT;
BEGIN
  SELECT count(*) INTO remaining_count
  FROM staging.raw_activity_items
  WHERE jsonb_typeof(occurrences) = 'string';

  IF remaining_count > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % linhas continuam com jsonb_typeof = string', remaining_count;
  END IF;

  RAISE NOTICE 'Backfill concluído — 0 linhas com jsonb_typeof = string restantes.';
END $$;
