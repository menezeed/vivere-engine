-- ============================================================
-- Migration 0015 — public.publication_events
--
-- Registo de eventos emitidos pelo Publishing Engine.
-- Na Fase 8, populado com NoOpEventEmitter (zero writes reais).
-- Na Fase 9, populado pelo EventEmitter concreto.
--
-- Design: append-only — eventos nunca são apagados.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.publication_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID        REFERENCES public.publication_runs(id) ON DELETE SET NULL,
  product_key     TEXT        NOT NULL,
  event_type      TEXT        NOT NULL
                    CHECK (event_type IN (
                      'VenuePublished', 'VenueUpdated', 'VenueArchived',
                      'ActivityPublished', 'ActivityUpdated', 'ActivityArchived',
                      'PublicationRunCompleted', 'PublicationRunFailed'
                    )),
  entity_id       UUID,         -- id em public.venues ou public.activities
  entity_type     TEXT          CHECK (entity_type IN ('venue', 'activity', 'run')),
  payload         JSONB,        -- campos alterados, métricas, etc.
  emitted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.publication_events IS
  'Catálogo de eventos emitidos pelo Publishing Engine. '
  'Append-only. Consumido por Notifications, Analytics e Cache (Fase 9+). '
  'Na Fase 8, NoOpEventEmitter não escreve aqui — tabela fica vazia.';

CREATE INDEX IF NOT EXISTS publication_events_run_idx
  ON public.publication_events (run_id);

CREATE INDEX IF NOT EXISTS publication_events_product_type_idx
  ON public.publication_events (product_key, event_type, emitted_at DESC);

CREATE INDEX IF NOT EXISTS publication_events_entity_idx
  ON public.publication_events (entity_type, entity_id, emitted_at DESC)
  WHERE entity_id IS NOT NULL;
