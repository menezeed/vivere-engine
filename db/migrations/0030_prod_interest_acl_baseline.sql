-- ============================================================
-- Migration 0030 — PRODUÇÃO: alinhar o ACL de activity_interests e
--                  active_activities com o ponto de partida da 0024
--
-- REF: E2 produção 20/11/2026, cenário D1 (reviews/E2/DECISAO-D1-0024.md),
-- opção 1 do PO (preparação técnica; aplicação exige REF Level 2 próprio).
-- ESTADO: PROPOSTA, NÃO APLICADA em nenhum Supabase. Validada só na
-- simulação local (db/audit/local/run-0030-prod-acl.sh).
--
-- ÂMBITO: SÓ PRODUÇÃO. Corre na W1 IMEDIATAMENTE ANTES da 0024 (fora da
-- ordem numérica, por desenho) e só com a 0023 saltada (cenário B/C da
-- §3a do runbook). No staging e em ambientes reconstruídos da cadeia, a
-- P1 aborta: lá o ACL já é o que a 0024 espera.
--
-- PORQUÊ
-- A P2 da 0024 exige o ACL exacto da 0000/0020 (base do seu rollback).
-- A produção difere em dois objectos (pré-voo, 20 linhas 0024 P2):
--  * activity_interests: anon tem SELECT, INSERT; authenticated tem
--    SELECT, INSERT, DELETE (a app instalada c390c92 escreve directamente
--    na tabela); faltam TRUNCATE, REFERENCES, TRIGGER, MAINTAIN de tabela
--    para os dois papéis;
--  * active_activities: anon e authenticated têm MAINTAIN (PG17) além
--    dos 7 privilégios da 0000. A 0024 não o revoga e a sua verificação
--    final exige que não exista.
-- Esta migração leva a produção EXACTAMENTE ao ponto de partida da 0024.
-- O estado final depois da 0024 é o mesmo do staging.
--
-- EFEITO NA APP INSTALADA: entre esta migração e a 0024 (o Run seguinte),
-- o upsert/delete directo em activity_interests passa a 42501. A app
-- ignora o erro (supabase-js devolve { error }, que não é lido) e segue
-- para o PATCH do contador. É o mesmo efeito que a 0024 tem por desenho.
--
-- RISCO TRANSITÓRIO: concede TRUNCATE/REFERENCES/TRIGGER/MAINTAIN em
-- activity_interests a anon/authenticated, porque a P2 da 0024 os exige
-- e a 0024 os revoga no Run seguinte. O PostgREST não expõe TRUNCATE.
-- Se a 0024 abortar: correr 0030_…rollback.sql na mesma sessão.
--
-- PRÉ-CONDIÇÕES (abortam tudo antes de qualquer alteração)
--  P1 Corre como postgres; 0024 por aplicar (set_activity_interest,
--     get_my_interests e delete_my_account ausentes).
--  P2 ACL de tabela EXACTO, para anon/authenticated/PUBLIC, com
--     grantor = quem corre, e nenhum privilégio de coluna:
--       activity_interests: anon {INSERT, SELECT};
--                           authenticated {DELETE, INSERT, SELECT}
--       active_activities:  anon e authenticated {os 7 da 0000 + MAINTAIN}
--     Qualquer diferença aborta: o estado não é o observado na E2.
--
-- NATUREZA: só GRANT/REVOKE em 2 tabelas; sem dados, sem DDL.
-- NÃO idempotente: reaplicar aborta em P2.
-- ROLLBACK: 0030_prod_interest_acl_baseline.rollback.sql (repõe o ACL
-- observado na produção). Ordem de rollback na W1: 0026 → 0025 → 0024 →
-- 0030.
-- ============================================================

begin;

do $pre$
declare
  v_problems text;
  v_me oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);
begin
  if current_user <> 'postgres' then
    raise exception '0030 abortada (P1): correr como postgres (current_user=%)', current_user;
  end if;

  select string_agg('funcao ja existe: public.' || f.proname, '; ') into v_problems
  from pg_catalog.pg_proc f
  join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
  where f.proname in ('set_activity_interest', 'get_my_interests', 'delete_my_account');
  if v_problems is not null then
    raise exception '0030 abortada (P1, 0024 ja aplicada?): %', v_problems;
  end if;

  with expected(tbl, grantee, priv) as (
    values ('activity_interests', 'anon', 'INSERT'), ('activity_interests', 'anon', 'SELECT'),
           ('activity_interests', 'authenticated', 'DELETE'), ('activity_interests', 'authenticated', 'INSERT'),
           ('activity_interests', 'authenticated', 'SELECT')
    union all
    select 'active_activities', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
  ),
  actual as (
    select c.relname::text as tbl,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type::text as priv
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and a.grantor = v_me
  ),
  problems as (
    (select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl as p from expected
     except select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl from actual)
    union all
    (select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from actual
     except select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from expected)
    union all
    select 'grantor diferente: ' || pg_catalog.pg_get_userbyid(a.grantee) || ' ' || a.privilege_type || ' ' || c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and a.grantor <> v_me
    union all
    select 'privilegio de coluna: ' || c.relname || '(' || att.attname || ') ' || a.privilege_type
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  )
  select string_agg(p, '; ' order by p) into v_problems from problems;
  if v_problems is not null then
    raise exception '0030 abortada (P2, ACL diferente do observado na E2; nada alterado): %', v_problems;
  end if;
end;
$pre$;

revoke select, insert on public.activity_interests from anon;
revoke select, insert, delete on public.activity_interests from authenticated;
grant truncate, references, trigger, maintain on public.activity_interests to anon, authenticated;
revoke maintain on public.active_activities from anon, authenticated;

-- Verificação final: exactamente o ponto de partida que a P2 da 0024 exige
do $post$
declare
  v_problems text;
  v_me oid := (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);
begin
  with expected(tbl, grantee, priv) as (
    select 'activity_interests', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
    union all
    select 'active_activities', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
  ),
  actual as (
    select c.relname::text as tbl,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type::text as priv
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      and a.grantor = v_me
  )
  select string_agg(p, '; ' order by p) into v_problems from (
    (select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl as p from expected
     except select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl from actual)
    union all
    (select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from actual
     except select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from expected)
    union all
    select 'activity_interests: ' || r || ' ainda tem ' || pr
    from unnest(array['anon', 'authenticated']) r
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
    where pg_catalog.has_table_privilege(r, 'public.activity_interests', pr)
       or (pr <> 'DELETE' and pg_catalog.has_any_column_privilege(r, 'public.activity_interests', pr))
    union all
    select r || ' ainda tem MAINTAIN em active_activities'
    from unnest(array['anon', 'authenticated']) r
    where pg_catalog.has_table_privilege(r, 'public.active_activities', 'MAINTAIN')
  ) x;
  if v_problems is not null then
    raise exception '0030 incompleta (verificacao final), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
