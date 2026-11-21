-- ============================================================
-- Migration 0032 — PRODUÇÃO: privilégio mínimo em categories, venues,
--                  partners e favorites (anon e authenticated)
--
-- REF: E2 produção 20/11/2026 (reviews/E2/AVALIACAO-EXCESSO.md: EXCESSO 3
-- e 4 e RISCO "TRUNCATE", ambos "depois da W1"); auditoria v2 da produção
-- capturada no A1 a 21/11/2026 (antes da W1; a W0/W1 não tocou nestas
-- tabelas). ESTADO: PROPOSTA, NÃO APLICADA em nenhum Supabase. Validada só
-- na simulação local (db/audit/local/run-0032-least-privilege.sh).
-- Aplicação exige REF Level 2 próprio.
--
-- ÂMBITO: SÓ PRODUÇÃO. No staging e em ambientes da cadeia, a 0023 deu
-- ACL mínimos e a P2 aborta (nada muda).
--
-- PORQUÊ
-- Na produção, anon e authenticated têm os 8 privilégios de tabela
-- (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN) nas 4 tabelas, herdados do default ACL. O RLS limita as linhas,
-- mas o TRUNCATE ignora o RLS, e o resto é superfície sem uso:
--  * favorites: anon nunca usa a tabela; authenticated tem UPDATE e INSERT
--    de tabela (EXCESSO 3 e 4: pode escolher id/created_at e alterar as
--    próprias linhas);
--  * categories/venues/partners: anon só lê; o admin (authenticated com
--    app_metadata.role = admin, política admin_role_all) escreve.
--
-- COMPATIBILIDADE (verificada a 21/11, código):
--  * app Play/teste (vivere-60plus c390c92 e lote3/android-preview) e app
--    vida-ativa-app: favorites só com sessão: select, delete,
--    insert({ user_id, activity_id }); categories/venues/partners só select;
--  * admin GitHub Pages (authenticated + JWT admin): CRUD em categories e
--    venues (mantido); lê favorites (mantido);
--  * engine/Review API: service_role (não alterado);
--  * cadeia W1: nenhuma migração nem rollback 0024–0031 inspecciona o ACL
--    destas 4 tabelas (a 0024 só exige SELECT de anon em categories, que
--    se mantém); a 0027 (W3) só exige SELECT.
--
-- ESTADO FINAL
--   categories, venues, partners: anon {SELECT};
--                                  authenticated {SELECT, INSERT, UPDATE, DELETE}
--   favorites: anon {}; authenticated {SELECT, DELETE} +
--              INSERT de coluna (user_id, activity_id)
--   service_role, RLS, políticas, triggers e dados: não alterados.
--
-- PRÉ-CONDIÇÕES (abortam tudo antes de qualquer alteração)
--  P1 Corre como postgres; as 4 tabelas existem, com RLS ligado; favorites
--     tem user_id e activity_id; favorites sem comentário (o comentário é
--     o marcador desta migração).
--  P2 ACL EXACTO observado na produção: para anon e authenticated, os 8
--     privilégios de tabela, grantor postgres, sem opção de concessão;
--     nenhuma entrada para PUBLIC nem de outro grantor; nenhum privilégio
--     de coluna para anon/authenticated/PUBLIC.
-- VERIFICAÇÃO FINAL: o ACL exacto do estado final, mais o marcador.
--
-- NATUREZA: só REVOKE/GRANT e um comentário; sem dados nem DDL de objectos.
-- NÃO idempotente: reaplicar aborta em P1 (marcador) ou P2.
-- ROLLBACK: 0032_prod_least_privilege_catalog_favorites.rollback.sql.
-- ============================================================

begin;

lock table public.categories, public.venues, public.partners, public.favorites in share row exclusive mode;

do $pre$
declare
  v_problems text;
begin
  if current_user <> 'postgres' then
    raise exception '0032 abortada (P1): correr como postgres (current_user=%)', current_user;
  end if;

  select string_agg(p, '; ' order by p) into v_problems from (
    select 'tabela em falta: public.' || t as p
    from unnest(array['categories', 'venues', 'partners', 'favorites']) t
    where pg_catalog.to_regclass('public.' || t) is null
    union all
    select 'rls desligado em public.' || c.relname
    from pg_catalog.pg_class c
    where c.oid in (select pg_catalog.to_regclass('public.' || t)
                    from unnest(array['categories', 'venues', 'partners', 'favorites']) t)
      and not c.relrowsecurity
    union all
    select 'coluna em falta: favorites.' || col
    from unnest(array['user_id', 'activity_id']) col
    where not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = pg_catalog.to_regclass('public.favorites')
                        and a.attname = col and a.attnum > 0 and not a.attisdropped)
    union all
    select 'favorites ja tem comentario (marcador da 0032 ou outro)'
    where pg_catalog.obj_description(pg_catalog.to_regclass('public.favorites'), 'pg_class') is not null
  ) x;
  if v_problems is not null then
    raise exception '0032 abortada (P1): %', v_problems;
  end if;

  with
  tabs(t) as (values ('categories'), ('venues'), ('partners'), ('favorites')),
  privs(p) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')),
  roles(r) as (values ('anon'), ('authenticated')),
  expected as (
    select t, r, p, 'postgres'::text as grantor, false as grantable
    from tabs, roles, privs),
  actual as (
    select c.relname::text as t,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as r,
           a.privilege_type::text as p,
           pg_catalog.pg_get_userbyid(a.grantor)::text as grantor,
           a.is_grantable as grantable
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.oid in (select pg_catalog.to_regclass('public.' || t) from tabs)
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))),
  diff as (
    (select 'em falta: ' as k, * from expected except select 'em falta: ', * from actual)
    union all
    (select 'inesperado: ', * from actual except select 'inesperado: ', * from expected)
    union all
    select 'privilegio de coluna: ', c.relname::text,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end,
           a.privilege_type::text || ' (' || att.attname || ')', pg_catalog.pg_get_userbyid(a.grantor)::text, a.is_grantable
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.oid in (select pg_catalog.to_regclass('public.' || t) from tabs)
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated')))
  select string_agg(k || t || ' ' || r || ' ' || p || ' grantor=' || grantor
                    || case when grantable then ' com opcao de concessao' else '' end, '; ' order by k, t, r, p)
    into v_problems from diff;
  if v_problems is not null then
    raise exception '0032 abortada (P2, ACL diferente do observado na producao; nada alterado): %', v_problems;
  end if;
end;
$pre$;

-- Catálogo: anon só lê; authenticated perde só o que nenhum cliente usa
revoke insert, update, delete, truncate, references, trigger, maintain
  on public.categories, public.venues, public.partners from anon;
revoke truncate, references, trigger, maintain
  on public.categories, public.venues, public.partners from authenticated;

-- Favoritos: só com sessão; INSERT só nas 2 colunas da app (EXCESSO 3 e 4)
revoke all on public.favorites from anon;
revoke insert, update, truncate, references, trigger, maintain on public.favorites from authenticated;
grant insert (user_id, activity_id) on public.favorites to authenticated;

comment on table public.favorites is
  'vivere:0032 aplicada (privilegio minimo em categories/venues/partners/favorites). Retirar so com 0032_prod_least_privilege_catalog_favorites.rollback.sql.';

do $post$
declare
  v_problems text;
begin
  with
  expected(t, r, p) as (values
    ('categories', 'anon', 'SELECT'),
    ('categories', 'authenticated', 'SELECT'), ('categories', 'authenticated', 'INSERT'),
    ('categories', 'authenticated', 'UPDATE'), ('categories', 'authenticated', 'DELETE'),
    ('venues', 'anon', 'SELECT'),
    ('venues', 'authenticated', 'SELECT'), ('venues', 'authenticated', 'INSERT'),
    ('venues', 'authenticated', 'UPDATE'), ('venues', 'authenticated', 'DELETE'),
    ('partners', 'anon', 'SELECT'),
    ('partners', 'authenticated', 'SELECT'), ('partners', 'authenticated', 'INSERT'),
    ('partners', 'authenticated', 'UPDATE'), ('partners', 'authenticated', 'DELETE'),
    ('favorites', 'authenticated', 'SELECT'), ('favorites', 'authenticated', 'DELETE'),
    ('favorites', 'authenticated', 'INSERT (user_id)'), ('favorites', 'authenticated', 'INSERT (activity_id)')),
  actual as (
    select c.relname::text as t,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as r,
           a.privilege_type::text as p
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories', 'venues', 'partners', 'favorites')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and pg_catalog.pg_get_userbyid(a.grantor) = 'postgres' and not a.is_grantable
    union all
    select c.relname::text,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end,
           a.privilege_type::text || ' (' || att.attname || ')'
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories', 'venues', 'partners', 'favorites')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and pg_catalog.pg_get_userbyid(a.grantor) = 'postgres' and not a.is_grantable
    union all
    -- qualquer entrada com outro grantor ou opção de concessão é sempre um erro
    select c.relname::text, 'grantor/opcao inesperados', a.privilege_type::text
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories', 'venues', 'partners', 'favorites')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and (pg_catalog.pg_get_userbyid(a.grantor) <> 'postgres' or a.is_grantable)),
  diff as (
    (select 'em falta: ' as k, * from expected except select 'em falta: ', * from actual)
    union all
    (select 'inesperado: ', * from actual except select 'inesperado: ', * from expected))
  select string_agg(k || t || ' ' || r || ' ' || p, '; ' order by k, t, r, p) into v_problems from diff;
  if v_problems is not null then
    raise exception '0032 verificacao final falhou: %', v_problems;
  end if;
  if pg_catalog.obj_description(pg_catalog.to_regclass('public.favorites'), 'pg_class')
     not like 'vivere:0032 aplicada %' then
    raise exception '0032 verificacao final falhou: marcador ausente';
  end if;
end;
$post$;

commit;
