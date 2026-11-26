-- ============================================================
-- Rollback 0023 — retirar os privilégios do app mobile concedidos pela
--                 0023_mobile_app_table_grants.sql
--
-- REF: VIVERE-SEC-O-016 / SEC-O-016B. ESTADO: PROPOSTA, NÃO APLICADA
-- em nenhum Supabase. Validado só na simulação local.
--
-- AVISO: NÃO EXECUTAR EM PRODUÇÃO (lá os privilégios vêm de antes da
-- cadeia; retirá-los quebra o app dos testers).
--
-- PORQUE É SEGURO
-- A 0023 só corre com estado limpo (pré-condição P2): nenhum dos
-- privilégios que concede existia antes. Este rollback:
--  R1 confirma que cada entrada de ACL que a 0023 criou existe, com
--     grantee anon/authenticated e grantor = o papel que corre o
--     rollback (o mesmo que aplicou a 0023);
--  R2 confirma que não há, para anon/authenticated nestas 5 tabelas,
--     nenhum privilégio SELECT/INSERT/UPDATE/DELETE além desses. Se
--     houver (alguém concedeu algo depois), aborta: um REVOKE de tabela
--     apagaria também privilégios de coluna desse tipo, e não se sabe se
--     o privilégio extra deve ficar;
--  R3 retira exactamente o que a 0023 concedeu, na mesma forma;
--  R4 confirma que anon/authenticated ficaram sem esses privilégios.
-- Qualquer falha aborta a transacção inteira: nada é retirado.
--
-- LIMITAÇÕES
--  * Depois do rollback o app em staging volta a falhar com 42501
--    (bloqueio D1).
--  * Não mexe em RLS, políticas nem dados (linhas de teste ficam).
--  * Correr com o mesmo papel que aplicou a 0023 (no Supabase,
--    `postgres`); caso contrário R1 aborta.
-- ============================================================

begin;

do $rb$
declare
  v_problems text;
begin
  with expected(tbl, grantee, priv, col) as (values
    ('categories', 'anon', 'SELECT', ''), ('categories', 'authenticated', 'SELECT', ''),
    ('venues', 'anon', 'SELECT', ''), ('venues', 'authenticated', 'SELECT', ''),
    ('partners', 'anon', 'SELECT', ''), ('partners', 'authenticated', 'SELECT', ''),
    ('favorites', 'authenticated', 'SELECT', ''), ('favorites', 'authenticated', 'DELETE', ''),
    ('favorites', 'authenticated', 'INSERT', 'activity_id'), ('favorites', 'authenticated', 'INSERT', 'user_id'),
    ('suggestions', 'anon', 'INSERT', 'comment'), ('suggestions', 'anon', 'INSERT', 'email'),
    ('suggestions', 'anon', 'INSERT', 'language'), ('suggestions', 'anon', 'INSERT', 'location'),
    ('suggestions', 'anon', 'INSERT', 'phone'), ('suggestions', 'anon', 'INSERT', 'title'),
    ('suggestions', 'authenticated', 'INSERT', 'comment'), ('suggestions', 'authenticated', 'INSERT', 'email'),
    ('suggestions', 'authenticated', 'INSERT', 'language'), ('suggestions', 'authenticated', 'INSERT', 'location'),
    ('suggestions', 'authenticated', 'INSERT', 'phone'), ('suggestions', 'authenticated', 'INSERT', 'title')
  ),
  acl as (
    -- privilégios de tabela
    select c.relname::text as tbl, pg_catalog.pg_get_userbyid(a.grantee)::text as grantee,
           a.privilege_type as priv, ''::text as col, a.grantor
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relname in ('categories', 'venues', 'partners', 'favorites', 'suggestions')
    union all
    -- privilégios de coluna
    select c.relname::text, pg_catalog.pg_get_userbyid(a.grantee)::text,
           a.privilege_type, att.attname::text, a.grantor
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.relname in ('categories', 'venues', 'partners', 'favorites', 'suggestions')
  ),
  scoped as (
    select * from acl
    where grantee in ('anon', 'authenticated')
      and priv in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ),
  problems as (
    select 'R1 em falta (ou outro grantor): ' || e.grantee || ' ' || e.priv || ' ' || e.tbl
           || case when e.col <> '' then '(' || e.col || ')' else '' end as p
    from expected e
    where not exists (select 1 from scoped s
                      where s.tbl = e.tbl and s.grantee = e.grantee and s.priv = e.priv
                        and s.col = e.col and s.grantor = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user))
    union all
    select 'R2 privilegio extra: ' || s.grantee || ' ' || s.priv || ' ' || s.tbl
           || case when s.col <> '' then '(' || s.col || ')' else '' end
           || ' grantor=' || pg_catalog.pg_get_userbyid(s.grantor)
    from scoped s
    where not exists (select 1 from expected e
                      where e.tbl = s.tbl and e.grantee = s.grantee and e.priv = s.priv
                        and e.col = s.col and s.grantor = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user))
  )
  select string_agg(p, '; ') into v_problems from problems;
  if v_problems is not null then
    raise exception 'Rollback 0023 abortado (nada retirado): %', v_problems;
  end if;
end;
$rb$;

revoke select on public.categories from anon, authenticated;
revoke select on public.venues     from anon, authenticated;
revoke select on public.partners   from anon, authenticated;

revoke select, delete on public.favorites from authenticated;
revoke insert (user_id, activity_id) on public.favorites from authenticated;

revoke insert (title, location, phone, comment, email, language)
  on public.suggestions from anon, authenticated;

do $post$
declare
  v_left text;
begin
  select string_agg(r || ' ' || p || ' ' || t, '; ') into v_left
  from (values ('categories', 'anon', 'SELECT'), ('categories', 'authenticated', 'SELECT'),
               ('venues', 'anon', 'SELECT'), ('venues', 'authenticated', 'SELECT'),
               ('partners', 'anon', 'SELECT'), ('partners', 'authenticated', 'SELECT'),
               ('favorites', 'authenticated', 'SELECT'), ('favorites', 'authenticated', 'DELETE'),
               ('favorites', 'authenticated', 'INSERT'),
               ('suggestions', 'anon', 'INSERT'), ('suggestions', 'authenticated', 'INSERT')) v(t, r, p)
  where pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.' || t), p)
     or (p <> 'DELETE' and pg_catalog.has_any_column_privilege(r, pg_catalog.to_regclass('public.' || t), p));
  if v_left is not null then
    raise exception 'Rollback 0023 incompleto (R4), transaccao desfeita: %', v_left;
  end if;
end;
$post$;

commit;
