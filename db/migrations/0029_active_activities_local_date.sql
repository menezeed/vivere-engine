-- ============================================================================
-- 0029 — public.active_activities filtra pela DATA LOCAL (America/Sao_Paulo)
-- ============================================================================
-- Problema: a vista compara start_date/end_date com CURRENT_DATE, que no
-- Supabase é a data UTC (TimeZone=UTC). As datas gravadas são datas LOCAIS
-- (convenção do engine e do app: hora local com sufixo Z; o app usa
-- start_date.slice(0,10)). Entre as 21:00 e as 24:00 locais, CURRENT_DATE já
-- é o dia seguinte e a vista esconde do app os eventos pontuais do próprio
-- dia e as actividades cujo end_date é hoje — 3 h antes do fim do dia.
--
-- Correcção: substituir CURRENT_DATE por
--   (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date
-- (data civil actual em São Paulo; sem horário de verão desde 2019, e mesmo
-- com DST a função usa a tabela de fusos do PostgreSQL).
--
-- Impacto: a data local é SEMPRE <= a data UTC, por isso o novo filtro é um
-- SUPERCONJUNTO do anterior — nenhuma linha visível hoje deixa de o ser; só
-- passam a ficar visíveis, das 21:00 às 24:00 locais, as linhas desse dia
-- local. Colunas, ordem, security_invoker e ACL mantêm-se
-- (CREATE OR REPLACE VIEW preserva privilégios e opções).
--
-- Pré-condição (P1): a vista existe, com security_invoker=true, comentário
-- NULL e a definição COMPLETA do baseline 0000 (projecção, origem e WHERE). Na produção a vista foi
-- criada manualmente antes do engine: se divergir, a migração ABORTA sem
-- alterar nada (comparar com a auditoria E2 antes da janela).
-- Rollback: 0029_active_activities_local_date.rollback.sql.
-- ============================================================================

do $p1$
declare
  -- Definição COMPLETA esperada (baseline 0000), só com espaços colapsados
  -- (maiúsculas/minúsculas PRESERVADAS, incluindo literais). Revisão r0 (ALTO):
  -- comparar fragmentos deixava passar filtros extra; revisão r1 (MÉDIO):
  -- lower() aceitaria uma vista com 'NONE'. Texto igual em pg_get_viewdef do
  -- PostgreSQL 17.11 (STG) e 18.6 (PGlite). Qualquer diferença → aborta sem
  -- alterar (impressões diferentes noutras versões só causam aborto).
  c_def_esperada constant text :=
    'SELECT id, title, description, category, venue_id, schedule, price, is_free, imagem_url, is_sponsored, created_at, start_date, end_date, recurrence_type, recurrence_days, recurrence_time, phone, url, interested_count FROM activities WHERE (((end_date IS NULL) OR (end_date >= CURRENT_DATE)) AND (((recurrence_type IS NOT NULL) AND (recurrence_type <> ''none''::text)) OR ((recurrence_type = ''none''::text) AND (start_date >= CURRENT_DATE))));';
  v_def text;
  v_inv boolean;
  v_com text;
begin
  if pg_catalog.to_regclass('public.active_activities') is null then
    raise exception '0029 P1: public.active_activities não existe';
  end if;

  select coalesce('security_invoker=true' = any(c.reloptions), false)
    into v_inv from pg_catalog.pg_class c where c.oid = 'public.active_activities'::regclass;
  if not v_inv then
    raise exception '0029 P1: active_activities sem security_invoker=true — divergente do esperado';
  end if;

  v_def := pg_catalog.btrim(pg_catalog.regexp_replace(
             pg_catalog.pg_get_viewdef('public.active_activities'::regclass), '[[:space:]]+', ' ', 'g'));
  if v_def is distinct from c_def_esperada then
    raise exception '0029 P1: definição de active_activities difere do baseline 0000 — não alterado. Actual: %', v_def;
  end if;

  -- Revisão r0 (MÉDIO): o rollback repõe comentário NULL; só é exacto se o
  -- estado inicial for NULL.
  v_com := pg_catalog.obj_description('public.active_activities'::regclass, 'pg_class');
  if v_com is not null then
    raise exception '0029 P1: active_activities tem comentário próprio — rollback não seria exacto; não alterado';
  end if;

  -- Estado do catálogo antes da alteração, para os testes compararem ACL,
  -- dono e opções (revisão r0, BAIXO). Temporária: desaparece no fim da
  -- transacção/sessão; não altera nada persistente.
  -- Fotografia sempre recriada (revisão r1): nunca reutiliza a de outro ensaio.
  drop table if exists pg_temp._m0029_pre;
  create temp table _m0029_pre on commit drop as
    select c.relacl::text as acl, c.relowner::regrole::text as owner, c.reloptions::text as opts
      from pg_catalog.pg_class c where c.oid = 'public.active_activities'::regclass;
end
$p1$;

create or replace view public.active_activities
with (security_invoker = true)
as
select id, title, description, category, venue_id, schedule, price,
  is_free, imagem_url, is_sponsored, created_at, start_date, end_date,
  recurrence_type, recurrence_days, recurrence_time, phone, url,
  interested_count
from public.activities
where (end_date is null
       or end_date >= (current_timestamp at time zone 'America/Sao_Paulo')::date)
  and (recurrence_type is not null and recurrence_type <> 'none'
       or recurrence_type = 'none'
          and start_date >= (current_timestamp at time zone 'America/Sao_Paulo')::date);

comment on view public.active_activities is
  'Actividades activas para o app. Filtro pela data civil de America/Sao_Paulo (0029); colunas e ACL do baseline 0000.';
