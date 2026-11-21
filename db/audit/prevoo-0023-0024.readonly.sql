-- E2 passo 5 (SO LEITURA): pre-voo da 0023 e da 0024 (integracao 078510a), como um unico SELECT.
-- Etapas BLOQUEANTES: 0023 P1a, 0023 P1b, MATRIZ, 0024 P1a, 0024 P1b, 0024 P2, 0024 VF
-- (verificacao final: default ACL de funcoes e heranca efectiva de papeis).
-- Esperada nos cenarios B/C: 0023 P2. ALERTAS: RISCO (escrita com RLS desligado; TRUNCATE) e EXCESSO.
-- Cenarios e decisao: docs/runbooks/production-rollout.md, seccao 3a.
-- So catalogo; nenhum dado de utilizador. Pode correr com qualquer papel: o "grantor esperado" esta
-- FIXO em postgres (o papel que aplicara as migracoes no SQL Editor), nao no papel de quem corre.
-- Nota: a P1a da 0024 assume a 0023 aplicada; sem ela aparece "0023 nao aplicada", o que e normal
-- antes da janela, salvo se os privilegios ja existirem em producao.
with me as (select r.oid as v_me from pg_catalog.pg_roles r where r.rolname = 'postgres'),
p23 as (
  select '0023 P2' as etapa, rol || ' ja tem ' || priv || ' em ' || tbl as motivo
  from (values
    ('categories', 'anon', 'SELECT'), ('categories', 'authenticated', 'SELECT'),
    ('venues', 'anon', 'SELECT'), ('venues', 'authenticated', 'SELECT'),
    ('partners', 'anon', 'SELECT'), ('partners', 'authenticated', 'SELECT'),
    ('favorites', 'authenticated', 'SELECT'), ('favorites', 'authenticated', 'DELETE'),
    ('favorites', 'authenticated', 'INSERT'),
    ('suggestions', 'anon', 'INSERT'), ('suggestions', 'authenticated', 'INSERT')) t(tbl, rol, priv)
  where pg_catalog.has_table_privilege(t.rol, pg_catalog.to_regclass('public.' || t.tbl), t.priv)
     or (t.priv <> 'DELETE'
         and pg_catalog.has_any_column_privilege(t.rol, pg_catalog.to_regclass('public.' || t.tbl), t.priv))
),
p23a as (
  select '0023 P1a' as etapa, 'rls desligado ou tabela em falta: ' || t as motivo
  from unnest(array['categories', 'venues', 'partners', 'favorites', 'suggestions']) t
  where not exists (select 1 from pg_catalog.pg_class c
                    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relkind = 'r' and c.relrowsecurity)
),
pol23_expected(tbl, pol, cmd, perm, roles, qual, chk) as (values
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
pol23_actual as (
  select p.tablename::text, p.policyname::text, p.cmd, p.permissive,
         pg_catalog.array_to_string(array(select r::text from unnest(p.roles) r order by 1), ','),
         coalesce(p.qual, '-'), coalesce(p.with_check, '-')
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('categories', 'venues', 'partners', 'favorites', 'suggestions')
),
p23b as (
  select '0023 P1b' as etapa, k || tbl || '.' || pol || ' [' || cmd || ']' as motivo from (
    (select 'esperada e ausente/diferente: ' as k, * from pol23_expected
     except select 'esperada e ausente/diferente: ', * from pol23_actual)
    union all
    (select 'inesperada: ', * from pol23_actual
     except select 'inesperada: ', * from pol23_expected)
  ) d
),
-- Proteccao efectiva (ALERTA, nao e pre-condicao de nenhuma migracao): tabelas de public onde
-- anon/authenticated podem escrever com o RLS desligado; e TRUNCATE, a que o RLS nao se aplica
-- (o PostgREST nao o expoe, mas qualquer caminho SQL com esses papeis sim).
risco as (
  select 'RISCO' as etapa, 'escrita sem RLS: ' || r || ' ' || pr || ' em ' || c.relname as motivo
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  cross join unnest(array['anon', 'authenticated']) r
  cross join unnest(array['INSERT', 'UPDATE', 'DELETE']) pr
  where c.relkind in ('r', 'p') and not c.relrowsecurity
    and (pg_catalog.has_table_privilege(r, c.oid, pr)
         or (pr <> 'DELETE' and pg_catalog.has_any_column_privilege(r, c.oid, pr)))
  union all
  select 'RISCO', 'TRUNCATE (ignora RLS): ' || r || ' em ' || c.relname
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  cross join unnest(array['anon', 'authenticated']) r
  where c.relkind in ('r', 'p') and pg_catalog.has_table_privilege(r, c.oid, 'TRUNCATE')
),
-- MATRIZ (revisao r0, ALTO): se a 0023 for saltada na producao, os privilegios que a app usa tem de
-- existir TODOS (a P2 da 0023 aborta com um so). Inclui o SELECT em activities que a verificacao final
-- da 0024 exige ('perdeu SELECT') e que a P2 dela nao verifica. Qualquer linha = cenario B/C invalido.
matriz as (
  select 'MATRIZ' as etapa, 'em falta: ' || m.rol || ' ' || m.priv || ' em ' || m.tbl
         || coalesce('(' || m.col || ')', '') as motivo
  from (values
    ('categories', 'anon', 'SELECT', null), ('categories', 'authenticated', 'SELECT', null),
    ('venues', 'anon', 'SELECT', null), ('venues', 'authenticated', 'SELECT', null),
    ('partners', 'anon', 'SELECT', null), ('partners', 'authenticated', 'SELECT', null),
    ('favorites', 'authenticated', 'SELECT', null), ('favorites', 'authenticated', 'DELETE', null),
    ('favorites', 'authenticated', 'INSERT', 'user_id'), ('favorites', 'authenticated', 'INSERT', 'activity_id'),
    ('suggestions', 'anon', 'INSERT', 'title'), ('suggestions', 'anon', 'INSERT', 'location'),
    ('suggestions', 'anon', 'INSERT', 'phone'), ('suggestions', 'anon', 'INSERT', 'comment'),
    ('suggestions', 'anon', 'INSERT', 'email'), ('suggestions', 'anon', 'INSERT', 'language'),
    ('suggestions', 'authenticated', 'INSERT', 'title'), ('suggestions', 'authenticated', 'INSERT', 'location'),
    ('suggestions', 'authenticated', 'INSERT', 'phone'), ('suggestions', 'authenticated', 'INSERT', 'comment'),
    ('suggestions', 'authenticated', 'INSERT', 'email'), ('suggestions', 'authenticated', 'INSERT', 'language'),
    ('activities', 'anon', 'SELECT', null), ('activities', 'authenticated', 'SELECT', null)) m(tbl, rol, priv, col)
  where pg_catalog.to_regclass('public.' || m.tbl) is null
     or (m.col is null and not pg_catalog.has_table_privilege(m.rol, pg_catalog.to_regclass('public.' || m.tbl), m.priv))
     or (m.col is not null and not coalesce(pg_catalog.has_column_privilege(m.rol, pg_catalog.to_regclass('public.' || m.tbl), m.col, m.priv), false))
),
-- Verificacao final da 0024 (revisao r0): o ACL das RPC novas tem de ser exactamente
-- {authenticated, postgres}. Um default ACL de funcoes em public (do papel postgres ou global) que
-- conceda EXECUTE a outro papel faz a 0024 reverter no fim. A 0024 so revoga de PUBLIC, anon,
-- authenticated e service_role.
p24vf as (
  select '0024 VF' as etapa, 'default ACL de funcoes concede EXECUTE a ' || pg_catalog.pg_get_userbyid(a.grantee)
         || ' (dono ' || pg_catalog.pg_get_userbyid(d.defaclrole) || ', esquema '
         || case when d.defaclnamespace = 0 then '(todos)' else d.defaclnamespace::regnamespace::text end || ')' as motivo
  from pg_catalog.pg_default_acl d
  cross join lateral pg_catalog.aclexplode(d.defaclacl) a
  where d.defaclobjtype = 'f'
    and d.defaclrole = (select v_me from me)
    and (d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace)
    and a.privilege_type = 'EXECUTE'
    and a.grantee <> 0
    and pg_catalog.pg_get_userbyid(a.grantee) not in ('anon', 'authenticated', 'service_role', 'postgres')
),
-- Heranca EFECTIVA (revisoes r1/r2): a 0024 so faz REVOKE directo e a verificacao final usa
-- has_*_privilege (que conta heranca). pg_has_role(..., 'USAGE') segue cadeias indirectas e respeita
-- INHERIT; uma filiacao sem heranca nao gera linha.
--  (a) anon ou service_role a herdar de authenticated recebem o EXECUTE das RPC novas (e anon o
--      UPDATE de activities): a verificacao final exige false e reverte;
--  (b) anon/authenticated a herdar de outro papel com ACL nos objectos que a 0024 verifica: esse
--      privilegio sobrevive aos REVOKE directos.
alvo_her as (
  select c.relname::text as obj, a.grantee
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  cross join lateral pg_catalog.aclexplode(c.relacl) a
  where c.relname in ('activities', 'active_activities', 'activity_interests')
  union all
  select 'increment_activity_interest', a.grantee
  from pg_catalog.pg_proc f
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
  where f.oid = pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)')
),
p24her as (
  select '0024 VF' as etapa, r || ' herda os privilegios de authenticated' as motivo
  from unnest(array['anon', 'service_role']) r
  where pg_catalog.pg_has_role(r, 'authenticated', 'USAGE')
  union
  select '0024 VF', x || ' herda de ' || pg_catalog.pg_get_userbyid(o.grantee) || ', que tem ACL em ' || o.obj
  from unnest(array['anon', 'authenticated']) x
  cross join alvo_her o
  where o.grantee <> 0
    and pg_catalog.pg_get_userbyid(o.grantee) not in ('anon', 'authenticated')
    and pg_catalog.pg_has_role(x, o.grantee, 'USAGE')
),
-- EXCESSO (revisao r0, ALTO; ALERTA): escritas nas 5 tabelas da 0023 alem da matriz da app que o
-- RLS NAO nega por completo. favorites: a politica ALL deixa authenticated actualizar as proprias
-- linhas se tiver UPDATE. suggestions: a politica de INSERT aceita colunas fora da matriz se houver
-- INSERT de tabela. Decisao explicita do PO antes de adiar a reducao.
excesso as (
  select 'EXCESSO' as etapa, x.rol || ' ' || x.priv || ' em ' || x.tbl || ': ' || x.efeito as motivo
  from (values
    ('favorites', 'authenticated', 'UPDATE', null::text[], 'altera as proprias linhas (politica ALL)'),
    ('favorites', 'authenticated', 'INSERT*', array['user_id', 'activity_id'], 'insere com colunas fora de (user_id, activity_id)'),
    ('suggestions', 'anon', 'INSERT*', array['title', 'location', 'phone', 'comment', 'email', 'language'],
      'insere com colunas fora da matriz (o RLS so exige status pending e titulo)'),
    ('suggestions', 'authenticated', 'INSERT*', array['title', 'location', 'phone', 'comment', 'email', 'language'],
      'insere com colunas fora da matriz (o RLS so exige status pending e titulo)')) x(tbl, rol, priv, permitidas, efeito)
  where case
          when x.priv = 'INSERT*' then exists (
            select 1 from pg_catalog.pg_attribute att
            where att.attrelid = pg_catalog.to_regclass('public.' || x.tbl) and att.attnum > 0 and not att.attisdropped
              and att.attname::text <> all (x.permitidas)
              and pg_catalog.has_column_privilege(x.rol, att.attrelid, att.attnum, 'INSERT'))
          else coalesce(pg_catalog.has_table_privilege(x.rol, pg_catalog.to_regclass('public.' || x.tbl), x.priv), false)
               or coalesce(pg_catalog.has_any_column_privilege(x.rol, pg_catalog.to_regclass('public.' || x.tbl), x.priv), false)
        end
),
p24a as (
  select '0024 P1a' as etapa, p as motivo from (
    select '0023 nao aplicada (anon sem SELECT em public.categories)' as p
    where not coalesce(pg_catalog.has_table_privilege('anon', pg_catalog.to_regclass('public.categories'), 'SELECT'), false)
    union all
    select 'rls desligado ou tabela em falta: ' || t
    from unnest(array['activities', 'activity_interests']) t
    where not exists (select 1 from pg_catalog.pg_class c
                      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t and c.relkind = 'r' and c.relrowsecurity)
    union all
    select 'trigger guard_activities_update ausente ou desactivado'
    where not exists (select 1 from pg_catalog.pg_trigger tg
                      where tg.tgrelid = pg_catalog.to_regclass('public.activities')
                        and tg.tgname = 'guard_activities_update' and tg.tgenabled = 'O')
    union all
    select 'funcao public.increment_activity_interest(uuid, smallint) ausente'
    where pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)') is null
    union all
    select 'funcao ja existe: public.' || f.proname || '(' || pg_catalog.pg_get_function_identity_arguments(f.oid) || ')'
    from pg_catalog.pg_proc f
    join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
    where f.proname in ('set_activity_interest', 'get_my_interests', 'delete_my_account')
  ) x
),
pol_expected(pol, cmd, perm, roles, qual, chk) as (values
  ('Leitura pública de atividades', 'SELECT', 'PERMISSIVE', 'public', 'true', '-'),
  ('admin_role_all', 'ALL', 'PERMISSIVE', 'authenticated',
    '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)',
    '(((auth.jwt() -> ''app_metadata''::text) ->> ''role''::text) = ''admin''::text)'),
  ('compat_interested_count_update', 'UPDATE', 'PERMISSIVE', 'anon,authenticated', 'true', 'true')
),
pol_actual as (
  select p.policyname::text, p.cmd, p.permissive,
         pg_catalog.array_to_string(array(select r::text from unnest(p.roles) r order by 1), ','),
         coalesce(p.qual, '-'), coalesce(p.with_check, '-')
  from pg_catalog.pg_policies p
  where p.schemaname = 'public' and p.tablename = 'activities'
),
p24b as (
  select '0024 P1b' as etapa, k || 'activities.' || pol || ' [' || cmd || ']' as motivo from (
    (select 'esperada e ausente/diferente: ' as k, * from pol_expected
     except select 'esperada e ausente/diferente: ', * from pol_actual)
    union all
    (select 'inesperada: ', * from pol_actual
     except select 'inesperada: ', * from pol_expected)
  ) d
),
acl_expected(tbl, grantee, priv) as (
  select 'activities', g, 'UPDATE' from unnest(array['anon', 'authenticated']) g
  union all
  select 'active_activities', g, p
  from unnest(array['anon', 'authenticated']) g
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  union all
  select 'activity_interests', g, p
  from unnest(array['anon', 'authenticated']) g
  cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
),
tacl as (
  select c.relname::text as tbl,
         case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
         a.privilege_type as priv, a.grantor
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  cross join lateral pg_catalog.aclexplode(c.relacl) a
  where c.relname in ('activities', 'active_activities', 'activity_interests')
),
cacl as (
  select c.relname::text as tbl, att.attname::text as col,
         case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
         a.privilege_type as priv
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
  cross join lateral pg_catalog.aclexplode(att.attacl) a
  where c.relname in ('activities', 'active_activities', 'activity_interests')
),
facl as (
  select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
         a.privilege_type as priv, a.grantor
  from pg_catalog.pg_proc f
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
  where f.oid = pg_catalog.to_regprocedure('public.increment_activity_interest(uuid, smallint)')
),
p24c as (
  select '0024 P2' as etapa, p as motivo from (
    select 'em falta (ou outro grantor): ' || e.grantee || ' ' || e.priv || ' ' || e.tbl as p
    from acl_expected e
    where not exists (select 1 from tacl t, me where t.tbl = e.tbl and t.grantee = e.grantee
                        and t.priv = e.priv and t.grantor = me.v_me)
    union all
    select 'privilegio inesperado: ' || t.grantee || ' ' || t.priv || ' ' || t.tbl
           || ' grantor=' || pg_catalog.pg_get_userbyid(t.grantor)
    from tacl t, me
    where t.grantee in ('anon', 'authenticated', 'PUBLIC')
      and (t.tbl in ('active_activities', 'activity_interests') or t.priv = 'UPDATE')
      and not exists (select 1 from acl_expected e where e.tbl = t.tbl and e.grantee = t.grantee
                        and e.priv = t.priv and t.grantor = me.v_me)
    union all
    select 'privilegio de coluna: ' || c.grantee || ' ' || c.priv || ' ' || c.tbl || '(' || c.col || ')'
    from cacl c
    where c.grantee in ('anon', 'authenticated', 'PUBLIC')
      and (c.tbl in ('active_activities', 'activity_interests') or c.priv = 'UPDATE')
    union all
    select 'activity_interests: ' || r || ' ja tem ' || pr
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
    where pg_catalog.has_table_privilege(r, pg_catalog.to_regclass('public.activity_interests'), pr)
       or (pr <> 'DELETE'
           and pg_catalog.has_any_column_privilege(r, pg_catalog.to_regclass('public.activity_interests'), pr))
    union all
    select 'increment_activity_interest: EXECUTE em falta (ou outro grantor) para ' || g
    from unnest(array['anon', 'authenticated']) g, me
    where not exists (select 1 from facl f where f.grantee = g and f.priv = 'EXECUTE' and f.grantor = me.v_me)
    union all
    select 'increment_activity_interest: EXECUTE para PUBLIC'
    where exists (select 1 from facl f where f.grantee = 'PUBLIC')
  ) y
)
select current_user as papel, etapa, motivo from p23a
union all select current_user, etapa, motivo from p23b
union all select current_user, etapa, motivo from p23
union all select current_user, etapa, motivo from risco
union all select current_user, etapa, motivo from matriz
union all select current_user, etapa, motivo from p24vf
union all select current_user, etapa, motivo from p24her
union all select current_user, etapa, motivo from excesso
union all select current_user, etapa, motivo from p24a
union all select current_user, etapa, motivo from p24b
union all select current_user, etapa, motivo from p24c
order by 2, 3;
