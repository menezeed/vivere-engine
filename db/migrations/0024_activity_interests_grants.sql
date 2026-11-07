-- ============================================================
-- Migration 0024 — Privilégios de public.activity_interests para o app
--
-- REF: VIVERE-SEC-O-016B. ESTADO: BLOQUEADA (decisão Level 2, opção b).
-- Não concede nada: executar este ficheiro só levanta uma excepção.
-- Não faz parte da cadeia aplicável até nova decisão e REF próprio.
--
-- EVIDÊNCIA (simulação local PostgreSQL 17.11,
-- db/audit/local/activity-interests-requirements.local.sql)
-- O app faz upsert com on_conflict=activity_id,device_id e
-- merge-duplicates, ou seja:
--   INSERT ... ON CONFLICT (activity_id, device_id)
--   DO UPDATE SET activity_id = EXCLUDED.activity_id,
--                 user_id = EXCLUDED.user_id, device_id = EXCLUDED.device_id
-- Privilégios exigidos pelo PostgreSQL, mesmo sem conflito:
--   * INSERT nas 3 colunas;
--   * UPDATE nas 3 colunas;
--   * SELECT nas colunas de conflito (activity_id, device_id) E nas
--     colunas lidas via EXCLUDED — logo também user_id.
--   Com SELECT só em (activity_id, device_id): negado (V3). Com SELECT
--   nas 3: funciona (V4). Com SET só de device_id: funciona (V6).
--   Mesmo ON CONFLICT ... DO NOTHING exige SELECT nas colunas de
--   conflito (P2); só um INSERT simples dispensa SELECT (P1).
--   DELETE com filtro por user_id exige SELECT(activity_id, user_id).
-- Conceder esses SELECT de coluna a anon/authenticated com as políticas
-- actuais não cumpre o critério de mínimo privilégio definido pelo
-- Level 2 (SEC-O-016B). Por isso nada é concedido aqui.
--
-- CONSEQUÊNCIA EM STAGING ENQUANTO BLOQUEADA
-- Marcar/desmarcar interesse não persiste (42501, ignorado pelo app; o
-- contador em activities muda na mesma). O fluxo de interesses NÃO está
-- validado em staging, e o staging não pode ser declarado totalmente
-- validado enquanto esta migração estiver bloqueada.
--
-- OPÇÕES PARA DECISÃO FUTURA (cada uma com REF próprio)
--  (a) Conceder INSERT/UPDATE/SELECT(3) a anon e authenticated e DELETE a
--      authenticated sem mudar código nem RLS. Rejeitada pelo Level 2
--      (SEC-O-016B): não cumpre o mínimo privilégio.
--  (b) Restringir a política SELECT (mudança de RLS) para que cada
--      cliente só veja as suas próprias linhas. Exige provar que o
--      upsert continua a funcionar (o ON CONFLICT avalia a política
--      SELECT na linha existente) — testar localmente primeiro.
--  (c) Mudar o app: INSERT simples (P1) ou uma função RPC SECURITY
--      DEFINER com validação própria. Mudança funcional do app.
-- ============================================================

do $$
begin
  raise exception '0024 BLOQUEADA (SEC-O-016B): sem GRANT de activity_interests ate decisao Level 2 e REF proprio.';
end;
$$;
