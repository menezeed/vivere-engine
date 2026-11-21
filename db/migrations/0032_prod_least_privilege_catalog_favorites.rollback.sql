-- ============================================================
-- Rollback 0032 — repõe o ACL da produção observado antes da 0032
-- (anon e authenticated com os 8 privilégios de tabela em categories,
-- venues, partners e favorites) e retira o marcador.
--
-- PRÉ-CONDIÇÕES (abortam tudo)
--  R1 Corre como postgres; marcador EXACTO da 0032 em favorites.
--  R2 ACL exacto do estado final da 0032 (nada foi alterado depois); RLS
--     ligado nas 4 tabelas.
-- VERIFICAÇÃO FINAL: o ACL exacto da P2 da 0032, sem marcador.
-- NATUREZA: só GRANT/REVOKE e o comentário; sem dados.
-- ============================================================

begin;

lock table public.categories, public.venues, public.partners, public.favorites in share row exclusive mode;

do $pre$
declare
  v_problems text;
begin
  if current_user <> 'postgres' then
    raise exception 'rollback 0032 abortado (R1): correr como postgres (current_user=%)', current_user;
  end if;
  if pg_catalog.obj_description(pg_catalog.to_regclass('public.favorites'), 'pg_class') is distinct from
     'vivere:0032 aplicada (privilegio minimo em categories/venues/partners/favorites). Retirar so com 0032_prod_least_privilege_catalog_favorites.rollback.sql.' then
    raise exception 'rollback 0032 abortado (R1): marcador da 0032 ausente ou diferente';
  end if;

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
           a.privilege_type::text
             || case when pg_catalog.pg_get_userbyid(a.grantor) <> 'postgres' or a.is_grantable
                     then ' (grantor/opcao inesperados)' else '' end as p
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories', 'venues', 'partners', 'favorites')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
    union all
    select c.relname::text,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end,
           a.privilege_type::text || ' (' || att.attname || ')'
             || case when pg_catalog.pg_get_userbyid(a.grantor) <> 'postgres' or a.is_grantable
                     then ' (grantor/opcao inesperados)' else '' end
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories', 'venues', 'partners', 'favorites')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))),
  diff as (
    (select 'em falta: ' as k, * from expected except select 'em falta: ', * from actual)
    union all
    (select 'inesperado: ', * from actual except select 'inesperado: ', * from expected)
    union all
    select 'rls desligado: ', c.relname::text, '', ''
    from pg_catalog.pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories', 'venues', 'partners', 'favorites') and not c.relrowsecurity)
  select string_agg(k || t || ' ' || r || ' ' || p, '; ' order by k, t, r, p) into v_problems from diff;
  if v_problems is not null then
    raise exception 'rollback 0032 abortado (R2, estado diferente do final da 0032; nada alterado): %', v_problems;
  end if;
end;
$pre$;

revoke insert (user_id, activity_id) on public.favorites from authenticated;
grant select, insert, update, delete, truncate, references, trigger, maintain
  on public.categories, public.venues, public.partners, public.favorites to anon, authenticated;
comment on table public.favorites is null;

do $post$
declare
  v_problems text;
begin
  with
  tabs(t) as (values ('categories'), ('venues'), ('partners'), ('favorites')),
  privs(p) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')),
  roles(r) as (values ('anon'), ('authenticated')),
  expected as (select t, r, p from tabs, roles, privs),
  actual as (
    select c.relname::text as t,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as r,
           a.privilege_type::text
             || case when pg_catalog.pg_get_userbyid(a.grantor) <> 'postgres' or a.is_grantable
                     then ' (grantor/opcao inesperados)' else '' end as p
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories', 'venues', 'partners', 'favorites')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
    union all
    select c.relname::text, 'coluna', a.privilege_type::text || ' (' || att.attname || ')'
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.relnamespace = 'public'::regnamespace
      and c.relname in ('categories', 'venues', 'partners', 'favorites')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))),
  diff as (
    (select 'em falta: ' as k, * from expected except select 'em falta: ', * from actual)
    union all
    (select 'inesperado: ', * from actual except select 'inesperado: ', * from expected))
  select string_agg(k || t || ' ' || r || ' ' || p, '; ' order by k, t, r, p) into v_problems from diff;
  if v_problems is not null then
    raise exception 'rollback 0032 verificacao final falhou: %', v_problems;
  end if;
  if pg_catalog.obj_description(pg_catalog.to_regclass('public.favorites'), 'pg_class') is not null then
    raise exception 'rollback 0032 verificacao final falhou: marcador ainda presente';
  end if;
end;
$post$;

commit;
