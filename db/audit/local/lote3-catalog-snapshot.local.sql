-- ============================================================
-- Instantâneo SÓ LEITURA do catálogo de segurança (Lote 3, 0026/0027).
-- Uma linha por facto, ordenada: comparar duas bases com `diff`.
-- Cobre schemas public e staging: ACL de tabela/vista/sequência e de
-- coluna (com grantor), ACL/dono/security definer/search_path/corpo das
-- funções, políticas, RLS, triggers, comentários e default ACL.
-- Uso: psql -At -X -d <base> -f lote3-catalog-snapshot.local.sql
-- ============================================================
with ns as (
  select oid, nspname from pg_catalog.pg_namespace where nspname in ('public', 'staging')
),
g(oid, name) as (
  select 0::oid, 'PUBLIC' union all select oid, rolname::text from pg_catalog.pg_roles
),
facts(line) as (
  select 'rel|' || n.nspname || '.' || c.relname || '|' || c.relkind::text || '|owner=' || pg_catalog.pg_get_userbyid(c.relowner)
         || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity
  from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace
  where c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
  union all
  select 'relacl|' || n.nspname || '.' || c.relname || '|' || ge.name || '|' || a.privilege_type
         || '|grantor=' || gr.name || '|grantable=' || a.is_grantable
  from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault(
      (case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
  join g ge on ge.oid = a.grantee join g gr on gr.oid = a.grantor
  where c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
  union all
  select 'colacl|' || n.nspname || '.' || c.relname || '.' || att.attname || '|' || ge.name || '|'
         || a.privilege_type || '|grantor=' || gr.name || '|grantable=' || a.is_grantable
  from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
  cross join lateral pg_catalog.aclexplode(att.attacl) a
  join g ge on ge.oid = a.grantee join g gr on gr.oid = a.grantor
  union all
  select 'colacl-null-vs-empty|' || n.nspname || '.' || c.relname || '.' || att.attname || '|'
         || case when att.attacl is null then 'null' else 'empty' end
  from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
  where att.attacl is not null and pg_catalog.cardinality(att.attacl) = 0
  union all
  select 'fn|' || f.oid::pg_catalog.regprocedure::text || '|owner=' || pg_catalog.pg_get_userbyid(f.proowner)
         || '|secdef=' || f.prosecdef || '|config=' || coalesce(f.proconfig::text, '-')
         || '|vol=' || f.provolatile::text || '|src=' || pg_catalog.md5(f.prosrc)
  from pg_catalog.pg_proc f join ns n on n.oid = f.pronamespace
  union all
  select 'fnacl|' || f.oid::pg_catalog.regprocedure::text || '|' || ge.name || '|' || a.privilege_type
         || '|grantor=' || gr.name || '|explicit=' || (f.proacl is not null)
  from pg_catalog.pg_proc f join ns n on n.oid = f.pronamespace
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f'::"char", f.proowner))) a
  join g ge on ge.oid = a.grantee join g gr on gr.oid = a.grantor
  union all
  select 'policy|' || p.schemaname || '.' || p.tablename || '|' || p.policyname || '|' || p.permissive
         || '|' || p.cmd || '|' || p.roles::text || '|' || coalesce(p.qual, '-') || '|' || coalesce(p.with_check, '-')
  from pg_catalog.pg_policies p where p.schemaname in ('public', 'staging')
  union all
  select 'trigger|' || n.nspname || '.' || c.relname || '|' || t.tgname || '|' || t.tgenabled::text
         || '|' || pg_catalog.md5(pg_catalog.pg_get_triggerdef(t.oid))
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
  join ns n on n.oid = c.relnamespace where not t.tgisinternal
  union all
  select 'comment|' || d.classoid::pg_catalog.regclass::text || '|'
         || coalesce(pg_catalog.pg_describe_object(d.classoid, d.objoid, d.objsubid), '?') || '|'
         || pg_catalog.md5(d.description)
  from pg_catalog.pg_description d
  where (d.classoid = 'pg_catalog.pg_class'::pg_catalog.regclass
         and d.objoid in (select c.oid from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace))
     or (d.classoid = 'pg_catalog.pg_proc'::pg_catalog.regclass
         and d.objoid in (select f.oid from pg_catalog.pg_proc f join ns n on n.oid = f.pronamespace))
     or (d.classoid = 'pg_catalog.pg_policy'::pg_catalog.regclass)
     or (d.classoid = 'pg_catalog.pg_trigger'::pg_catalog.regclass)
  union all
  select 'defacl|' || pg_catalog.pg_get_userbyid(da.defaclrole) || '|' || coalesce(n.nspname, '*') || '|'
         || da.defaclobjtype::text || '|' || ge.name || '|' || a.privilege_type
  from pg_catalog.pg_default_acl da
  left join pg_catalog.pg_namespace n on n.oid = da.defaclnamespace
  cross join lateral pg_catalog.aclexplode(da.defaclacl) a
  join g ge on ge.oid = a.grantee
)
select line from facts order by line;
