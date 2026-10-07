-- ============================================================
-- Rollback 0022 — desligar RLS em products, sources,
--                 publication_runs e publication_events
--
-- AVISO: NÃO EXECUTAR EM PRODUÇÃO. Lá, anon e authenticated têm
-- privilégios completos nestas tabelas e o RLS sem políticas é a única
-- protecção; desligá-lo exporia-as à Data API. Só se aplica a um
-- ambiente reconstruído da cadeia (ex: staging) onde a 0022 ligou o RLS.
-- ============================================================

ALTER TABLE public.products           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_runs   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_events DISABLE ROW LEVEL SECURITY;
