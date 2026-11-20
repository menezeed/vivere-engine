-- ============================================================
-- Rollback 0031 — PRODUÇÃO: repor o INSERT de TABELA em public.suggestions
--                 para anon e authenticated (estado observado na E2)
--
-- REF: ver 0031_suggestions_insert_columns.sql. ESTADO: PROPOSTA, NÃO
-- APLICADA. Validado só na simulação local.
--
-- AVISO: repõe o excesso (escolha de id, schedule e created_at por anon).
-- Só para voltar atrás se a 0031 partir um cliente.
--
-- R1 Corre como postgres; o MARCADOR EXACTO da 0031 (comentário em suggestions)
--    tem de existir. Sem ele, recusa: o staging (0023) tem o mesmo ACL por
--    coluna e não deve ganhar INSERT de tabela.
-- R2 RLS ligado e política da 0020 iguais (revalidados sob o lock); ACL
--    exacto deixado pela 0031: sem INSERT de tabela para anon/
--    authenticated/PUBLIC; INSERT por coluna exactamente nas 6 colunas,
--    grantor postgres, sem opção de concessão; nenhum outro privilégio de
--    coluna.
-- R3 REVOKE INSERT (retira também o de coluna); GRANT INSERT de tabela a
--    anon e authenticated; retira o marcador.
-- R4 Confirma: INSERT de tabela (grantor postgres, sem opção de
--    concessão) para os dois papéis, sem privilégios de coluna, sem
--    marcador.
-- ============================================================

begin;

lock table public.suggestions in share row exclusive mode;

do $pre$
declare
  v_problems text;
  v_tbl regclass := pg_catalog.to_regclass('public.suggestions');
begin
  if current_user <> 'postgres' then
    raise exception 'rollback 0031 abortado (R1): correr como postgres (current_user=%)', current_user;
  end if;
  -- Marcador EXACTO escrito pela 0031 (revisão r0: um prefixo não basta)
  if pg_catalog.obj_description(v_tbl, 'pg_class') is distinct from
     'vivere:0031 aplicada (INSERT so nas colunas da app). Retirar so com 0031_suggestions_insert_columns.rollback.sql.' then
    raise exception 'rollback 0031 abortado (R1): marcador da 0031 ausente ou diferente; a 0031 nao foi aplicada neste ambiente';
  end if;

  -- RLS e política revalidados sob o lock (revisão r0, ALTO): repor INSERT de tabela sem o
  -- with check (status pending, título não vazio) abriria a tabela.
  select string_agg(p, '; ' order by p) into v_problems from (
    select 'rls desligado em suggestions' as p
    where not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = v_tbl)
    union all
    select 'politica esperada ausente/diferente'
    where not exists (
      select 1 from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.tablename = 'suggestions'
        and p.policyname = 'Publico pode enviar sugestao pendente' and p.cmd = 'INSERT' and p.permissive = 'PERMISSIVE'
        and pg_catalog.array_to_string(array(select r::text from unnest(p.roles) r order by 1), ',') = 'public'
        and p.qual is null
        and p.with_check = '((status = ''pending''::text) AND (length(TRIM(BOTH FROM title)) > 0))')
    union all
    select 'politica inesperada: ' || p.policyname
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'suggestions'
      and p.policyname <> 'Publico pode enviar sugestao pendente'
  ) x;
  if v_problems is not null then
    raise exception 'rollback 0031 abortado (R2, RLS/politica diferentes; nada alterado): %', v_problems;
  end if;

  select string_agg(p, '; ' order by p) into v_problems from (
    select 'INSERT de tabela: ' || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end as p
    from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.oid = v_tbl and a.privilege_type = 'INSERT'
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
    union all
    select 'INSERT de coluna em falta: ' || r || ' ' || col
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['title', 'location', 'phone', 'comment', 'email', 'language']) col
    where not exists (select 1 from pg_catalog.pg_attribute att cross join lateral pg_catalog.aclexplode(att.attacl) a
                      where att.attrelid = v_tbl and att.attname = col and a.privilege_type = 'INSERT'
                        and a.grantee <> 0 and pg_catalog.pg_get_userbyid(a.grantee) = r
                        and pg_catalog.pg_get_userbyid(a.grantor) = 'postgres' and not a.is_grantable)
    union all
    select 'entrada de coluna inesperada: ' || att.attname || ' ' || a.privilege_type || ' '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end
    from pg_catalog.pg_attribute att
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where att.attrelid = v_tbl and att.attnum > 0 and not att.attisdropped
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and not (a.privilege_type = 'INSERT' and a.grantee <> 0
               and att.attname in ('title', 'location', 'phone', 'comment', 'email', 'language')
               and pg_catalog.pg_get_userbyid(a.grantor) = 'postgres' and not a.is_grantable)
  ) x;
  if v_problems is not null then
    raise exception 'rollback 0031 abortado (R2, estado diferente do deixado pela 0031; nada alterado): %', v_problems;
  end if;
end;
$pre$;

revoke insert on public.suggestions from anon, authenticated;
grant insert on public.suggestions to anon, authenticated;
comment on table public.suggestions is null;

do $post$
declare
  v_problems text;
  v_tbl regclass := pg_catalog.to_regclass('public.suggestions');
begin
  select string_agg(p, '; ' order by p) into v_problems from (
    select 'INSERT de tabela em falta para ' || r as p
    from unnest(array['anon', 'authenticated']) r
    where not exists (select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
                      where c.oid = v_tbl and a.privilege_type = 'INSERT' and a.grantee <> 0
                        and pg_catalog.pg_get_userbyid(a.grantee) = r
                        and pg_catalog.pg_get_userbyid(a.grantor) = 'postgres' and not a.is_grantable)
    union all
    select 'privilegio de coluna: ' || att.attname || ' ' || a.privilege_type
    from pg_catalog.pg_attribute att
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where att.attrelid = v_tbl and att.attnum > 0 and not att.attisdropped
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
    union all
    select 'marcador da 0031 ainda presente'
    where pg_catalog.obj_description(v_tbl, 'pg_class') is not null
  ) x;
  if v_problems is not null then
    raise exception 'rollback 0031 incompleto (verificacao final), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
