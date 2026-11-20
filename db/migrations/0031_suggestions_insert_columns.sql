-- ============================================================
-- Migration 0031 — PRODUÇÃO: INSERT em public.suggestions só nas 6
--                  colunas que a app usa (anon e authenticated)
--
-- REF: E2 produção 20/11/2026, alertas EXCESSO 1 e 2
-- (reviews/E2/AVALIACAO-EXCESSO.md); PO autorizou a PREPARAÇÃO antes da
-- W1 (aplicação exige REF Level 2 próprio). ESTADO: PROPOSTA, NÃO
-- APLICADA em nenhum Supabase. Validada só na simulação local
-- (db/audit/local/run-0031-suggestions.sh).
--
-- ÂMBITO: SÓ PRODUÇÃO, numa janela própria ANTES da W1. Independente da
-- W1: a 0024, a 0025, a 0026, a 0029 e a 0030 não verificam nem alteram
-- suggestions. No staging e em ambientes da cadeia, a 0023 já concede o
-- INSERT por coluna e esta migração aborta (P2).
--
-- PORQUÊ
-- Na produção, anon e authenticated têm INSERT de TABELA em suggestions.
-- O RLS (política da 0020) só obriga status = 'pending' e título não
-- vazio, por isso qualquer pessoa com a chave anon (pública, vem na app)
-- pode escolher id, schedule e created_at (data falsa na triagem do admin).
--
-- COMPATIBILIDADE (verificada a 20/11): a app móvel (Android e iOS, o mesmo
-- código; c390c92, main e todos os ramos: 71 ocorrências) só faz
--   supabase.from('suggestions').insert({ title, location, phone, comment,
--                                         email, language })
-- sem .select()/.upsert()/.update(); o supabase-js v2 envia
-- Prefer: return=minimal, por isso não precisa de SELECT. O engine, o
-- painel admin e os scripts não escrevem em suggestions. Os defaults (id,
-- status 'pending', created_at) continuam a aplicar-se.
--
-- PRÉ-CONDIÇÕES (abortam tudo antes de qualquer alteração)
--  P1 Corre como postgres; suggestions existe, com RLS ligado e EXACTAMENTE
--     a política da 0020; as 6 colunas existem; suggestions sem comentário
--     (o comentário é o marcador desta migração).
--  P2 anon e authenticated com INSERT de TABELA, grantor postgres, sem
--     opção de concessão; nenhum INSERT de outro grantor nem para PUBLIC;
--     nenhum privilégio de COLUNA em suggestions para anon/authenticated/
--     PUBLIC. Os outros privilégios de tabela não são alterados.
-- VERIFICAÇÃO FINAL: sem INSERT de tabela; INSERT por coluna exactamente
-- nas 6 colunas (grantor postgres, sem opção de concessão) e em nenhuma
-- outra; marcador presente.
--
-- NATUREZA: só GRANT/REVOKE e um comentário numa tabela; sem dados.
-- NÃO idempotente: reaplicar aborta em P1 (marcador).
-- ROLLBACK: 0031_suggestions_insert_columns.rollback.sql.
-- ============================================================

begin;

lock table public.suggestions in share row exclusive mode;

do $pre$
declare
  v_problems text;
  v_tbl regclass := pg_catalog.to_regclass('public.suggestions');
begin
  if current_user <> 'postgres' then
    raise exception '0031 abortada (P1): correr como postgres (current_user=%)', current_user;
  end if;
  if v_tbl is null then
    raise exception '0031 abortada (P1): public.suggestions nao existe';
  end if;
  if pg_catalog.obj_description(v_tbl, 'pg_class') is not null then
    raise exception '0031 abortada (P1): suggestions ja tem comentario (marcador da 0031 ou outro): %',
      pg_catalog.obj_description(v_tbl, 'pg_class');
  end if;

  select string_agg(p, '; ' order by p) into v_problems from (
    select 'rls desligado em suggestions' as p
    where not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = v_tbl)
    union all
    select 'coluna em falta: ' || col
    from unnest(array['title', 'location', 'phone', 'comment', 'email', 'language']) col
    where not exists (select 1 from pg_catalog.pg_attribute a
                      where a.attrelid = v_tbl and a.attname = col and a.attnum > 0 and not a.attisdropped)
    union all
    (select 'politica esperada ausente/diferente' from (values (
       'Publico pode enviar sugestao pendente', 'INSERT', 'PERMISSIVE', 'public', '-',
       '((status = ''pending''::text) AND (length(TRIM(BOTH FROM title)) > 0))')) e(pol, cmd, perm, roles, qual, chk)
     except
     select 'politica esperada ausente/diferente' from pg_catalog.pg_policies p
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
    raise exception '0031 abortada (P1): %', v_problems;
  end if;

  select string_agg(p, '; ' order by p) into v_problems from (
    select 'INSERT de tabela em falta (grantor postgres, sem opcao de concessao) para ' || r as p
    from unnest(array['anon', 'authenticated']) r
    where not exists (select 1 from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
                      where c.oid = v_tbl and a.privilege_type = 'INSERT' and a.grantee <> 0
                        and pg_catalog.pg_get_userbyid(a.grantee) = r
                        and pg_catalog.pg_get_userbyid(a.grantor) = 'postgres' and not a.is_grantable)
    union all
    select 'INSERT inesperado: ' || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end
           || ' grantor=' || pg_catalog.pg_get_userbyid(a.grantor) || case when a.is_grantable then ' com opcao de concessao' else '' end
    from pg_catalog.pg_class c cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.oid = v_tbl and a.privilege_type = 'INSERT'
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and not (a.grantee <> 0 and pg_catalog.pg_get_userbyid(a.grantor) = 'postgres' and not a.is_grantable)
    union all
    select 'privilegio de coluna: ' || att.attname || ' ' || a.privilege_type || ' para '
           || case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end
    from pg_catalog.pg_attribute att
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where att.attrelid = v_tbl and att.attnum > 0 and not att.attisdropped
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  ) x;
  if v_problems is not null then
    raise exception '0031 abortada (P2, ACL diferente do observado na E2; nada alterado): %', v_problems;
  end if;
end;
$pre$;

revoke insert on public.suggestions from anon, authenticated;
grant insert (title, location, phone, comment, email, language) on public.suggestions to anon, authenticated;

comment on table public.suggestions is
  'vivere:0031 aplicada (INSERT so nas colunas da app). Retirar so com 0031_suggestions_insert_columns.rollback.sql.';

do $post$
declare
  v_problems text;
  v_tbl regclass := pg_catalog.to_regclass('public.suggestions');
begin
  select string_agg(p, '; ' order by p) into v_problems from (
    select r || ' ainda tem INSERT de tabela' as p
    from unnest(array['anon', 'authenticated']) r
    where pg_catalog.has_table_privilege(r, v_tbl, 'INSERT')
    union all
    select r || ' sem INSERT em ' || att.attname
    from unnest(array['anon', 'authenticated']) r
    cross join pg_catalog.pg_attribute att
    where att.attrelid = v_tbl and att.attnum > 0 and not att.attisdropped
      and att.attname in ('title', 'location', 'phone', 'comment', 'email', 'language')
      and not pg_catalog.has_column_privilege(r, v_tbl, att.attnum, 'INSERT')
    union all
    select r || ' com INSERT fora da matriz em ' || att.attname
    from unnest(array['anon', 'authenticated']) r
    cross join pg_catalog.pg_attribute att
    where att.attrelid = v_tbl and att.attnum > 0 and not att.attisdropped
      and att.attname not in ('title', 'location', 'phone', 'comment', 'email', 'language')
      and pg_catalog.has_column_privilege(r, v_tbl, att.attnum, 'INSERT')
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
    union all
    select 'marcador da 0031 em falta'
    where coalesce(pg_catalog.obj_description(v_tbl, 'pg_class'), '') not like 'vivere:0031 aplicada%'
  ) x;
  if v_problems is not null then
    raise exception '0031 incompleta (verificacao final), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
