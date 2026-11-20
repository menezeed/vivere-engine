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
-- P2 aborta: lá o ACL já é o que a 0024 espera.
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
-- O estado final depois da 0024 é o mesmo do staging (mais o comentário
-- marcador desta migração em activity_interests).
--
-- EFEITO NA APP INSTALADA: entre esta migração e a 0024 (o Run seguinte),
-- o upsert/delete directo em activity_interests passa a 42501. A app
-- ignora o erro (supabase-js devolve { error }, que não é lido) e segue
-- para o PATCH do contador. É o mesmo efeito que a 0024 tem por desenho.
--
-- RISCO TRANSITÓRIO: concede TRUNCATE/REFERENCES/TRIGGER/MAINTAIN em
-- activity_interests a anon/authenticated, porque a P2 da 0024 os exige
-- e a 0024 os revoga no Run seguinte. O PostgREST não expõe TRUNCATE.
-- Se a 0024 (ou a 0025/0026, ver runbook §4) abortar: rollback até à 0030.
--
-- PRÉ-CONDIÇÕES (abortam tudo antes de qualquer alteração; os dois
-- objectos ficam bloqueados contra escrita concorrente durante a transacção)
--  P1 Corre como postgres; 0024 por aplicar (set_activity_interest,
--     get_my_interests e delete_my_account ausentes); activity_interests
--     sem comentário (o comentário é o marcador desta migração).
--  P2 ACL de tabela EXACTO, para anon/authenticated/PUBLIC: grantor =
--     postgres, SEM opção de concessão, nenhuma entrada de outro grantor,
--     nenhum privilégio de coluna:
--       activity_interests: anon {INSERT, SELECT};
--                           authenticated {DELETE, INSERT, SELECT}
--       active_activities:  anon e authenticated {os 7 da 0000 + MAINTAIN}
--     Qualquer diferença aborta: o estado não é o observado na E2.
-- VERIFICAÇÃO FINAL: o mesmo conjunto completo de regras, sobre o ponto de
-- partida da 0024, mais o marcador presente.
--
-- NATUREZA: só GRANT/REVOKE e um comentário em 2 tabelas; sem dados.
-- NÃO idempotente: reaplicar aborta em P1 (marcador) ou P2.
-- ROLLBACK: 0030_prod_interest_acl_baseline.rollback.sql (repõe o ACL
-- observado na produção e retira o marcador). Ordem de rollback na W1:
-- 0026 → 0025 → 0024 → 0030.
-- ============================================================

begin;

lock table public.activity_interests, public.active_activities in share row exclusive mode;

-- Regras de ACL partilhadas pela pré-condição e pela verificação final.
-- Função temporária (pg_temp), apagada antes do COMMIT.
create function pg_temp.vivere_0030_acl_problems(p_state text) returns text
language sql stable as $f$
  with expected(tbl, grantee, priv) as (
    select * from (values
      ('activity_interests', 'anon', 'INSERT'), ('activity_interests', 'anon', 'SELECT'),
      ('activity_interests', 'authenticated', 'DELETE'), ('activity_interests', 'authenticated', 'INSERT'),
      ('activity_interests', 'authenticated', 'SELECT')) v(tbl, grantee, priv)
    where p_state = 'producao'
    union all
    select 'activity_interests', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
    where p_state = 'base0024'
    union all
    select 'active_activities', g, p
    from unnest(array['anon', 'authenticated']) g
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
    where p = 'MAINTAIN' and p_state = 'producao' or p <> 'MAINTAIN'
  ),
  acl as (
    select c.relname::text as tbl,
           case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type::text as priv, pg_catalog.pg_get_userbyid(a.grantor)::text as grantor, a.is_grantable
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join lateral pg_catalog.aclexplode(c.relacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  ),
  actual as (select tbl, grantee, priv from acl where grantor = 'postgres')
  select string_agg(p, '; ' order by p) from (
    (select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl as p from expected
     except select 'em falta: ' || grantee || ' ' || priv || ' ' || tbl from actual)
    union all
    (select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from actual
     except select 'inesperado: ' || grantee || ' ' || priv || ' ' || tbl from expected)
    union all
    select 'grantor diferente (' || grantor || '): ' || grantee || ' ' || priv || ' ' || tbl
    from acl where grantor <> 'postgres'
    union all
    select 'com opcao de concessao: ' || grantee || ' ' || priv || ' ' || tbl
    from acl where is_grantable
    union all
    select 'privilegio de coluna: ' || c.relname || '(' || att.attname || ') ' || a.privilege_type
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral pg_catalog.aclexplode(att.attacl) a
    where c.relname in ('activity_interests', 'active_activities')
      and (a.grantee = 0 or pg_catalog.pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
  ) x
$f$;

do $pre$
declare
  v_problems text;
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

  if pg_catalog.obj_description('public.activity_interests'::regclass, 'pg_class') is not null then
    raise exception '0030 abortada (P1): activity_interests ja tem comentario (marcador da 0030 ou outro): %',
      pg_catalog.obj_description('public.activity_interests'::regclass, 'pg_class');
  end if;

  v_problems := pg_temp.vivere_0030_acl_problems('producao');
  if v_problems is not null then
    raise exception '0030 abortada (P2, ACL diferente do observado na E2; nada alterado): %', v_problems;
  end if;
end;
$pre$;

revoke select, insert on public.activity_interests from anon;
revoke select, insert, delete on public.activity_interests from authenticated;
grant truncate, references, trigger, maintain on public.activity_interests to anon, authenticated;
revoke maintain on public.active_activities from anon, authenticated;

comment on table public.activity_interests is
  'vivere:0030 aplicada (ACL de producao alinhado com a P2 da 0024). Retirar so com 0030_prod_interest_acl_baseline.rollback.sql.';

-- Verificação final: exactamente o ponto de partida que a P2 da 0024 exige
do $post$
declare
  v_problems text;
begin
  v_problems := pg_temp.vivere_0030_acl_problems('base0024');
  if v_problems is null then
    select string_agg(p, '; ') into v_problems from (
      select 'activity_interests: ' || r || ' ainda tem ' || pr as p
      from unnest(array['anon', 'authenticated']) r
      cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
      where pg_catalog.has_table_privilege(r, 'public.activity_interests', pr)
         or (pr <> 'DELETE' and pg_catalog.has_any_column_privilege(r, 'public.activity_interests', pr))
      union all
      select r || ' ainda tem MAINTAIN em active_activities'
      from unnest(array['anon', 'authenticated']) r
      where pg_catalog.has_table_privilege(r, 'public.active_activities', 'MAINTAIN')
      union all
      select 'marcador da 0030 em falta'
      where coalesce(pg_catalog.obj_description('public.activity_interests'::regclass, 'pg_class'), '') not like 'vivere:0030 aplicada%'
    ) x;
  end if;
  if v_problems is not null then
    raise exception '0030 incompleta (verificacao final), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

drop function pg_temp.vivere_0030_acl_problems(text);

commit;
