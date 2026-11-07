-- ============================================================
-- Auditoria de privilégios, RLS e políticas (SÓ LEITURA)
-- REF: VIVERE-SEC-O-016 / SEC-O-016B. Correr em STAGING e em PRODUÇÃO,
-- em separado, seguindo db/audit/README.md.
--
-- É UMA ÚNICA instrução SELECT sobre o catálogo do PostgreSQL. Não lê
-- linhas de nenhuma tabela da aplicação, não escreve e só chama funções
-- de catálogo do pg_catalog (qualificadas), que não têm efeitos. A saída
-- contém só metadados (tabelas, papéis, privilégios, grantor, expressões
-- de políticas, versão), sem dados pessoais nem credenciais.
--
-- Validada na simulação local PostgreSQL 17.11 (SEC-O-016B).
--
-- Colunas: sec | objeto | papel | detalhe | estado
--   estado: OK / FALTA / PENDENTE / EXTRA / INFO / ATENCAO
--   Secção I compara o real com o desenho (0023; activity_interests fica
--   PENDENTE até à 0024). Em produção, EXTRA é esperado e informativo:
--   NÃO assumir que produção e staging são iguais.
-- ============================================================
with
rels(rel) as (values
  ('public.activities'), ('public.active_activities'), ('public.categories'),
  ('public.venues'), ('public.partners'), ('public.favorites'),
  ('public.activity_interests'), ('public.suggestions'), ('public.users'),
  ('public.products'), ('public.sources'), ('public.publication_runs'),
  ('public.publication_events')),
roles(rol) as (values ('anon'), ('authenticated'), ('service_role')),
privs(p) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')),
-- O que o app mobile PRECISA (T = tabela, C = coluna). 0000 + 0023 + 0024.
need(rel, rol, p, lvl, origem) as (values
  ('public.activities',         'anon',          'SELECT', 'T', '0000'),
  ('public.activities',         'authenticated', 'SELECT', 'T', '0000'),
  ('public.activities',         'anon',          'UPDATE', 'C', '0000'),
  ('public.activities',         'authenticated', 'UPDATE', 'C', '0000'),
  ('public.active_activities',  'anon',          'SELECT', 'T', '0000'),
  ('public.active_activities',  'authenticated', 'SELECT', 'T', '0000'),
  ('public.categories',         'anon',          'SELECT', 'T', '0023'),
  ('public.categories',         'authenticated', 'SELECT', 'T', '0023'),
  ('public.venues',             'anon',          'SELECT', 'T', '0023'),
  ('public.venues',             'authenticated', 'SELECT', 'T', '0023'),
  ('public.partners',           'anon',          'SELECT', 'T', '0023'),
  ('public.partners',           'authenticated', 'SELECT', 'T', '0023'),
  ('public.favorites',          'authenticated', 'SELECT', 'T', '0023'),
  ('public.favorites',          'authenticated', 'INSERT', 'C', '0023'),
  ('public.favorites',          'authenticated', 'DELETE', 'T', '0023'),
  ('public.suggestions',        'anon',          'INSERT', 'C', '0023'),
  ('public.suggestions',        'authenticated', 'INSERT', 'C', '0023'),
  ('public.activity_interests', 'anon',          'INSERT', 'C', '0024'),
  ('public.activity_interests', 'authenticated', 'INSERT', 'C', '0024'),
  ('public.activity_interests', 'anon',          'UPDATE', 'C', '0024'),
  ('public.activity_interests', 'authenticated', 'UPDATE', 'C', '0024'),
  ('public.activity_interests', 'anon',          'SELECT', 'C', '0024'),
  ('public.activity_interests', 'authenticated', 'SELECT', 'C', '0024'),
  ('public.activity_interests', 'authenticated', 'DELETE', 'T', '0024')),
cls as (
  select r.rel, c.oid, c.relkind::text as relkind, c.relrowsecurity, c.relforcerowsecurity,
         c.reloptions, c.relacl, pg_catalog.pg_get_userbyid(c.relowner)::text as owner
  from rels r left join pg_catalog.pg_class c on c.oid = pg_catalog.to_regclass(r.rel)),
-- T = privilégio de tabela; C = só em algumas colunas; - = nenhum
eff as (
  select cl.rel, ro.rol, pv.p,
    case
      when cl.oid is null then '?'
      when pg_catalog.has_table_privilege(ro.rol, cl.oid, pv.p) then 'T'
      when pv.p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
           and pg_catalog.has_any_column_privilege(ro.rol, cl.oid, pv.p) then 'C'
      else '-' end as v
  from cls cl cross join roles ro cross join privs pv),
out(ord, sec, objeto, papel, detalhe, estado) as (
  -- V. Versão do servidor
  select 10, 'V versao', 'server_version', '',
    pg_catalog.current_setting('server_version') || ' (num ' || pg_catalog.current_setting('server_version_num') || ')',
    'INFO'

  -- A. Existência, tipo, dono e RLS
  union all
  select 100, 'A rls', cl.rel, '',
    case when cl.oid is null then 'NAO EXISTE'
         else 'kind=' || cl.relkind || ' owner=' || cl.owner
           || ' rls=' || coalesce(cl.relrowsecurity::text, 'n/a')
           || ' force=' || coalesce(cl.relforcerowsecurity::text, 'n/a')
           || ' policies=' || (select pg_catalog.count(*) from pg_catalog.pg_policy po where po.polrelid = cl.oid)::text
           || ' options=' || coalesce(pg_catalog.array_to_string(cl.reloptions, ','), '-') end,
    case when cl.oid is null then 'ATENCAO'
         when cl.relkind = 'r' and not cl.relrowsecurity then 'ATENCAO'
         else 'INFO' end
  from cls cl

  -- B. Matriz de privilégios efectivos (7 privilégios por papel)
  union all
  select 200, 'B privs', e.rel, e.rol,
    pg_catalog.string_agg(pg_catalog.left(e.p, 3) || '=' || e.v, ' ' order by pg_catalog.array_position(
      array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'], e.p)),
    'INFO'
  from eff e group by e.rel, e.rol

  -- C. Privilégios só de coluna (anon/authenticated)
  union all
  select 300, 'C colunas', n.nspname::text || '.' || c.relname::text, g.rol,
    pp.p || '(' || pg_catalog.string_agg(a.attname::text, ',' order by a.attnum) || ')', 'INFO'
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  cross join (values ('anon'), ('authenticated')) g(rol)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE')) pp(p)
  where (n.nspname::text || '.' || c.relname::text) in (select rel from rels)
    and pg_catalog.has_column_privilege(g.rol, c.oid, a.attnum, pp.p)
    and not pg_catalog.has_table_privilege(g.rol, c.oid, pp.p)
  group by n.nspname, c.relname, g.rol, pp.p

  -- L. Entradas de ACL com grantor (tabela e coluna), base do rollback
  union all
  select 350, 'L acl', cl.rel,
    case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end,
    a.privilege_type || ' (tabela) grantor=' || pg_catalog.pg_get_userbyid(a.grantor)::text
      || case when a.is_grantable then ' WITH GRANT OPTION' else '' end,
    'INFO'
  from cls cl cross join lateral pg_catalog.aclexplode(cl.relacl) a
  where a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role')
  union all
  select 351, 'L acl', cl.rel,
    case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end,
    a.privilege_type || '(' || att.attname::text || ') grantor=' || pg_catalog.pg_get_userbyid(a.grantor)::text,
    'INFO'
  from cls cl
  join pg_catalog.pg_attribute att on att.attrelid = cl.oid and att.attnum > 0 and not att.attisdropped
  cross join lateral pg_catalog.aclexplode(att.attacl) a
  where a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role')

  -- D. Políticas RLS
  union all
  select 400, 'D policies', p.schemaname::text || '.' || p.tablename::text,
    pg_catalog.array_to_string(p.roles, ','),
    p.policyname::text || ' | ' || p.cmd || ' | ' || p.permissive
      || ' | using=' || coalesce(p.qual, '-')
      || ' | check=' || coalesce(p.with_check, '-'),
    'INFO'
  from pg_catalog.pg_policies p
  where (p.schemaname::text || '.' || p.tablename::text) in (select rel from rels)

  -- E. USAGE em schemas
  union all
  select 500, 'E schema', s.sch, r.rol,
    'USAGE=' || pg_catalog.has_schema_privilege(r.rol, s.sch, 'USAGE')::text,
    case when s.sch = 'staging' and r.rol in ('anon', 'authenticated')
              and pg_catalog.has_schema_privilege(r.rol, s.sch, 'USAGE') then 'ATENCAO'
         when s.sch in ('public', 'auth') and r.rol in ('anon', 'authenticated')
              and not pg_catalog.has_schema_privilege(r.rol, s.sch, 'USAGE') then 'FALTA'
         else 'INFO' end
  from (values ('public'), ('staging'), ('auth')) s(sch)
  cross join roles r
  where exists (select 1 from pg_catalog.pg_namespace where nspname = s.sch)

  -- F. Funções: EXECUTE e SECURITY DEFINER (public + auth.uid/jwt/role)
  union all
  select 600, 'F funcoes',
    n.nspname::text || '.' || f.proname::text || '(' || pg_catalog.pg_get_function_identity_arguments(f.oid) || ')',
    r.rol,
    'execute=' || pg_catalog.has_function_privilege(r.rol, f.oid, 'EXECUTE')::text
      || ' secdef=' || f.prosecdef::text
      || ' config=' || coalesce(pg_catalog.array_to_string(f.proconfig, ','), '-'),
    case when n.nspname = 'auth' and not pg_catalog.has_function_privilege(r.rol, f.oid, 'EXECUTE') then 'FALTA'
         else 'INFO' end
  from pg_catalog.pg_proc f
  join pg_catalog.pg_namespace n on n.oid = f.pronamespace
  cross join (values ('anon'), ('authenticated')) r(rol)
  where (n.nspname = 'public' and f.proname in ('guard_activities_update', 'increment_activity_interest'))
     or (n.nspname = 'auth' and f.proname in ('uid', 'jwt', 'role'))

  -- G. Sequências em public (o desenho não precisa de nenhuma: PKs uuid)
  union all
  select 700, 'G sequencias', n.nspname::text || '.' || c.relname::text, r.rol,
    'USAGE=' || pg_catalog.has_sequence_privilege(r.rol, c.oid, 'USAGE')::text
      || ' owner=' || pg_catalog.pg_get_userbyid(c.relowner)::text,
    'INFO'
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rol)
  where c.relkind = 'S' and n.nspname = 'public'

  -- H. Triggers nas tabelas auditadas
  union all
  select 800, 'H triggers', cl.rel, '',
    t.tgname::text || ' -> ' || t.tgfoid::regprocedure::text || ' enabled=' || t.tgenabled::text,
    'INFO'
  from cls cl join pg_catalog.pg_trigger t on t.tgrelid = cl.oid and not t.tgisinternal

  -- I. Real vs. desenho (app mobile)
  union all
  select 900, 'I desenho', n.rel, n.rol,
    n.p || ' precisa=' || n.lvl || ' real=' || coalesce(e.v, '?') || ' origem=' || n.origem,
    case when coalesce(e.v, '-') not in ('-', '?') then 'OK'
         when n.origem = '0024' then 'PENDENTE'
         else 'FALTA' end
  from need n left join eff e on e.rel = n.rel and e.rol = n.rol and e.p = n.p
  union all
  select 910, 'I desenho', e.rel, e.rol,
    e.p || ' real=' || e.v || ' (nao usado pelo app)', 'EXTRA'
  from eff e
  where e.rol in ('anon', 'authenticated') and e.v in ('T', 'C')
    and not exists (select 1 from need n where n.rel = e.rel and n.rol = e.rol and n.p = e.p)

  -- J. Default privileges (explica diferenças entre ambientes)
  union all
  select 1000, 'J default acl', coalesce(n.nspname::text, '(global)'),
    pg_catalog.pg_get_userbyid(d.defaclrole)::text,
    d.defaclobjtype::text || ' ' || pg_catalog.array_to_string(d.defaclacl, ','), 'INFO'
  from pg_catalog.pg_default_acl d
  left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname is null or n.nspname = 'public'

  -- K. Marcadores da cadeia de migrações (lacuna L1)
  union all
  select 1100, 'K cadeia', m.mig, '', m.facto, case when m.ok then 'OK' else 'FALTA' end
  from (values
    ('0012', 'public.venues.engine_status',
      exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'venues' and column_name = 'engine_status')),
    ('0013', 'public.activities.engine_status',
      exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'activities' and column_name = 'engine_status')),
    ('0014', 'public.publication_runs', pg_catalog.to_regclass('public.publication_runs') is not null),
    ('0020', 'trigger guard_activities_update',
      exists (select 1 from pg_catalog.pg_trigger where tgname = 'guard_activities_update')),
    ('0020', 'policy compat_interested_count_update',
      exists (select 1 from pg_catalog.pg_policies where policyname = 'compat_interested_count_update')),
    ('0021', 'staging.venues_staging.geographic_status',
      exists (select 1 from information_schema.columns where table_schema = 'staging'
              and table_name = 'venues_staging' and column_name = 'geographic_status')),
    ('0022', 'rls public.products',
      coalesce((select relrowsecurity from pg_catalog.pg_class
                where oid = pg_catalog.to_regclass('public.products')), false)),
    ('0023', 'anon SELECT public.categories',
      coalesce(pg_catalog.has_table_privilege('anon', pg_catalog.to_regclass('public.categories'), 'SELECT'), false))
  ) m(mig, facto, ok)
)
select sec, objeto, papel, detalhe, estado
from out
order by ord, objeto, papel, detalhe;
