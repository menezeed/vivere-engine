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
-- Pré-condição (P1): a vista existe, com security_invoker=true, exactamente
-- as 19 colunas abaixo e o filtro do baseline 0000. Na produção a vista foi
-- criada manualmente antes do engine: se divergir, a migração ABORTA sem
-- alterar nada (comparar com a auditoria E2 antes da janela).
-- Rollback: 0029_active_activities_local_date.rollback.sql.
-- ============================================================================

do $p1$
declare
  v_def  text;
  v_cols text;
  v_inv  boolean;
begin
  if pg_catalog.to_regclass('public.active_activities') is null then
    raise exception '0029 P1: public.active_activities não existe';
  end if;

  select coalesce('security_invoker=true' = any(c.reloptions), false)
    into v_inv from pg_catalog.pg_class c where c.oid = 'public.active_activities'::regclass;
  if not v_inv then
    raise exception '0029 P1: active_activities sem security_invoker=true — divergente do esperado';
  end if;

  select string_agg(a.attname, ',' order by a.attnum) into v_cols
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.active_activities'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_cols is distinct from
     'id,title,description,category,venue_id,schedule,price,is_free,imagem_url,is_sponsored,created_at,start_date,end_date,recurrence_type,recurrence_days,recurrence_time,phone,url,interested_count' then
    raise exception '0029 P1: colunas de active_activities divergentes: %', v_cols;
  end if;

  v_def := pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_viewdef('public.active_activities'::regclass), '\s+', ' ', 'g'));
  if pg_catalog.strpos(v_def, 'end_date >= current_date') = 0
     or pg_catalog.strpos(v_def, 'start_date >= current_date') = 0 then
    raise exception '0029 P1: filtro de active_activities não é o do baseline 0000 — não alterado';
  end if;
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
