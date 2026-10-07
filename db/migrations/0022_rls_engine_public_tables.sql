-- ============================================================
-- Migration 0022 — RLS ligado em products, sources,
--                  publication_runs e publication_events
--
-- CONTEXTO (Phase D / N3):
-- Na produção, estas 4 tabelas de public têm RLS ligado e nenhuma
-- política (assinatura de schema da produção, 04/10/2026), e anon e
-- authenticated têm privilégios de tabela completos nelas. É o RLS sem
-- políticas que as torna inacessíveis a esses roles. A cadeia 0000-0021
-- não o captura: a 0020 liga RLS nas 7 tabelas legadas de public e em 6
-- de staging (a 0002 já ligava nas 2 raw_*), mas não nestas 4.
--
-- CONTRATO (produção, assinatura N3.1):
--   products, sources, publication_runs, publication_events:
--   relrowsecurity = true, relforcerowsecurity = false, zero políticas.
--
-- EFEITO: anon e authenticated, sujeitos a RLS, deixam de poder ler ou
-- escrever nestas tabelas (não há política que o permita). service_role
-- tem BYPASSRLS e o dono (postgres) também ignora RLS por não haver
-- FORCE: o Engine, o seed e as manutenções no SQL Editor não são
-- afectados. Não altera privilégios de tabela.
--
-- NATUREZA: idempotente por natureza (repetir ENABLE ROW LEVEL SECURITY
-- não faz nada), por isso sem IF NOT EXISTS. Sem DROP, sem dados, sem
-- políticas, sem FORCE. Em produção seria um no-op, mas não deve ser
-- executada lá sem autorização própria.
--
-- ROLLBACK: ver 0022_rls_engine_public_tables.rollback.sql
-- (NÃO usar em produção: retiraria a única protecção destas tabelas
-- contra anon e authenticated).
-- ============================================================

ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_events ENABLE ROW LEVEL SECURITY;
