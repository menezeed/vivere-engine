-- ============================================================
-- Migration 0023 — Privilégios mínimos de tabela para o app mobile
--                  (anon e authenticated) em 5 tabelas legadas sem
--                  GRANT explícito na 0000
--
-- REF: VIVERE-SEC-O-016 / SEC-O-016B. ESTADO: PROPOSTA, NÃO APLICADA
-- em nenhum Supabase. Validada só na simulação local (db/audit/local).
-- Aplicar apenas com REF próprio, depois da auditoria
-- db/audit/grants-audit.readonly.sql no ambiente alvo.
--
-- CONTEXTO
-- A 0000 só fixa o ACL de activities, active_activities e users. Nas
-- outras tabelas legadas fica o default ACL de quem as cria, que no SQL
-- Editor do Supabase não dá SELECT/INSERT/UPDATE/DELETE a anon nem a
-- authenticated (cabeçalho da 0000, Fase 16E; runbook §5). O app mobile
-- falha então com 42501 (bloqueio D1, SEC-O-015).
--
-- PRINCÍPIO
-- GRANT decide QUE operações um papel pode tentar; o RLS da 0020 decide
-- EM QUE LINHAS. Só se concede o que o app faz, com privilégios de coluna
-- onde o app escreve um subconjunto conhecido. NÃO copia o ACL da
-- produção. NÃO altera RLS, políticas, funções, triggers, service_role,
-- activities, active_activities, users nem activity_interests.
--
-- MATRIZ (fonte: chamadas .from() em vivere-60plus/src)
--   categories   anon+auth  SELECT
--   venues       anon+auth  SELECT  (inclui o embed venues(...))
--   partners     anon+auth  SELECT
--   favorites    auth       SELECT, DELETE, INSERT(user_id, activity_id)
--                anon       nada (o app só consulta com sessão)
--   suggestions  anon+auth  INSERT(title, location, phone, comment,
--                                  email, language); sem SELECT
--
-- FORA DESTA MIGRAÇÃO: activity_interests (0024, BLOQUEADA). A simulação
-- local provou que o upsert do app exige SELECT nas 3 colunas, incluindo
-- user_id, o que, com a política "Qualquer um pode ver interesses",
-- exporia identificadores a anon. Ver 0024_activity_interests_grants.sql.
--
-- PRÉ-CONDIÇÕES (verificadas antes de qualquer GRANT; abortam tudo)
--  P1 (S1) RLS ligado nas 5 tabelas, e o conjunto de políticas de cada
--     uma é EXACTAMENTE o da 0020: mesmo número, nomes, comando, tipo
--     (permissive), papéis e expressões. Uma política a mais (ex.:
--     using (true)) ou alterada aborta: com ela, os GRANT abririam acesso.
--     As expressões comparam-se com o texto que o PostgreSQL devolve em
--     pg_policies; se o formato diferir noutra versão, a migração aborta
--     (falha segura) e o texto esperado tem de ser revisto.
--  P2 (S2) Estado limpo: nenhum dos privilégios que esta migração concede
--     pode já existir (de tabela ou de qualquer coluna, directo ou via
--     PUBLIC). Se existir, aborta e devolve a decisão ao Level 2. Assim a
--     0023 nunca coincide com privilégios preexistentes e o rollback, que
--     retira só o que a 0023 deu, nunca apaga nada anterior.
--
-- ÂMBITO: staging e ambientes reconstruídos da cadeia. Em produção, P2
-- deve abortar (o app lá funciona, logo os privilégios já existem); não
-- aplicar lá sem REF próprio.
--
-- NATUREZA: só GRANT, sem REVOKE, sem dados, sem DDL de objectos.
-- ROLLBACK: 0023_mobile_app_table_grants.rollback.sql.
-- ============================================================

begin;

do $pre$
declare
  v_problems text;
begin
  -- P1a: RLS ligado
  select string_agg('rls desligado ou tabela em falta: ' || t, '; ')
    into v_problems
  from unnest(array['categories', 'venues', 'partners', 'favorites', 'suggestions']) t
  where not exists (select 1 from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t
                      and c.relkind = 'r' and c.relrowsecurity);
  if v_problems is not null then
    raise exception '0023 abortada (P1): %', v_problems;
  end if;

  -- P1b: conjunto exacto de políticas (diferença simétrica = vazio)
  with expected(tbl, pol, cmd, perm, roles, qual, chk) as (values
    ('categories', 'Qualquer um pode ver categorias', 'SELECT', 'PERMISSIVE', 'public', 'true', '-'),
    ('categories', 'admin_role_all', 'ALL', 'PERMISSIVE', 'authenticated',
      '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)',
      '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)'),
    ('venues', 'Leitura pública de venues', 'SELECT', 'PERMISSIVE', 'public', 'true', '-'),
    ('venues', 'admin_role_all', 'ALL', 'PERMISSIVE', 'authenticated',
      '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)',
      '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)'),
    ('partners', 'Leitura pública de parceiros', 'SELECT', 'PERMISSIVE', 'public', 'true', '-'),
    ('partners', 'admin_role_all', 'ALL', 'PERMISSIVE', 'authenticated',
      '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)',
      '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)'),
    ('favorites', 'Favoritos do usuário', 'ALL', 'PERMISSIVE', 'public', '(auth.uid() = user_id)', '-'),
    ('suggestions', 'Publico pode enviar sugestao pendente', 'INSERT', 'PERMISSIVE', 'public', '-',
      '((status = ''pending''::text) AND (length(TRIM(BOTH FROM title)) > 0))')
  ),
  actual as (
    select p.tablename::text, p.policyname::text, p.cmd, p.permissive,
           pg_catalog.array_to_string(array(select r::text from unnest(p.roles) r order by 1), ','),
           coalesce(p.qual, '-'), coalesce(p.with_check, '-')
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('categories', 'venues', 'partners', 'favorites', 'suggestions')
  ),
  diff as (
    (select 'esperada e ausente/diferente: ' as k, * from expected
     except select 'esperada e ausente/diferente: ', * from actual)
    union all
    (select 'inesperada: ', * from actual
     except select 'inesperada: ', * from expected)
  )
  select string_agg(k || tbl || '.' || pol || ' [' || cmd || ']', '; ')
    into v_problems from diff;
  if v_problems is not null then
    raise exception '0023 abortada (P1, politicas): %', v_problems;
  end if;

  -- P2: estado limpo (nenhum privilégio-alvo já existe, tabela ou coluna)
  with target(tbl, rol, priv) as (values
    ('categories', 'anon', 'SELECT'), ('categories', 'authenticated', 'SELECT'),
    ('venues', 'anon', 'SELECT'), ('venues', 'authenticated', 'SELECT'),
    ('partners', 'anon', 'SELECT'), ('partners', 'authenticated', 'SELECT'),
    ('favorites', 'authenticated', 'SELECT'), ('favorites', 'authenticated', 'DELETE'),
    ('favorites', 'authenticated', 'INSERT'),
    ('suggestions', 'anon', 'INSERT'), ('suggestions', 'authenticated', 'INSERT'))
  select string_agg(rol || ' ja tem ' || priv || ' em ' || tbl, '; ')
    into v_problems
  from target t
  where pg_catalog.has_table_privilege(t.rol, pg_catalog.to_regclass('public.' || t.tbl), t.priv)
     or (t.priv <> 'DELETE'
         and pg_catalog.has_any_column_privilege(t.rol, pg_catalog.to_regclass('public.' || t.tbl), t.priv));
  if v_problems is not null then
    raise exception '0023 abortada (P2, privilegios preexistentes; decisao Level 2): %', v_problems;
  end if;
end;
$pre$;

-- Catálogo público (leitura)
grant select on public.categories to anon, authenticated;
grant select on public.venues     to anon, authenticated;
grant select on public.partners   to anon, authenticated;

-- Favoritos (só com sessão; o RLS limita às próprias linhas)
grant select, delete on public.favorites to authenticated;
grant insert (user_id, activity_id) on public.favorites to authenticated;

-- Sugestões (só escrita; status fica 'pending' por default)
grant insert (title, location, phone, comment, email, language)
  on public.suggestions to anon, authenticated;

commit;
