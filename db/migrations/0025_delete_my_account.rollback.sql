-- ============================================================
-- Rollback 0025 — retirar public.delete_my_account()
--
-- REF: Lote 2 (contrato v1.1, C2). ESTADO: PROPOSTA, NÃO APLICADA em
-- nenhum Supabase. Validado só na simulação local.
--
-- A 0025 só cria a função (sem GRANT em tabelas, sem políticas). Este
-- rollback:
--  R1 confirma que a função existe com dono postgres, SECURITY DEFINER,
--     search_path vazio e EXECUTE só para o dono e authenticated; se o
--     estado for outro, aborta sem alterar nada;
--  R3 apaga a função;
--  R4 confirma que já não existe nenhuma public.delete_my_account.
-- DADOS: contas já apagadas e sugestões já anonimizadas NÃO são
-- recuperáveis (o rollback não toca em dados).
-- Correr com o mesmo papel que aplicou a 0025 (no Supabase, `postgres`).
-- ============================================================

begin;

do $rb$
declare
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    select 'R1 funcao em falta: public.delete_my_account()' as p
    where pg_catalog.to_regprocedure('public.delete_my_account()') is null
    union all
    select 'R1 outra assinatura: public.delete_my_account(' || pg_catalog.pg_get_function_identity_arguments(f.oid) || ')'
    from pg_catalog.pg_proc f
    join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
    where f.proname = 'delete_my_account' and f.pronargs <> 0
    union all
    select 'R1 dono/config/ACL inesperados'
    from pg_catalog.pg_proc f
    where f.oid = pg_catalog.to_regprocedure('public.delete_my_account()')
      and not (f.prosecdef and f.proconfig = array['search_path=""']
               and pg_catalog.pg_get_userbyid(f.proowner) = 'postgres'
               and array(select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
                                || ':' || a.privilege_type
                         from pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                         order by 1)
                   = array['authenticated:EXECUTE', 'postgres:EXECUTE'])
  ) x;
  if v_problems is not null then
    raise exception 'Rollback 0025 abortado (nada alterado): %', v_problems;
  end if;
end;
$rb$;

drop function public.delete_my_account();

do $post$
begin
  if exists (select 1 from pg_catalog.pg_proc f
             join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
             where f.proname = 'delete_my_account') then
    raise exception 'Rollback 0025 incompleto (R4), transaccao desfeita: delete_my_account ainda existe';
  end if;
end;
$post$;

commit;
