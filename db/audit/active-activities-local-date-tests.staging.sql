-- ============================================================================
-- Testes da 0029 (active_activities pela data local) — SÓ STAGING
-- ============================================================================
-- Uso (SQL Editor do STAGING, confirmar o ref no URL): colar NUM SÓ BLOCO
--   0. begin;   (transacção explícita: a garantia não depende do cliente)
--   1. o conteúdo de db/migrations/0029_active_activities_local_date.sql
--   2. este ficheiro, com v_confirm := 'staging'
-- e correr; depois, se o cliente não o fizer, "rollback;". Os testes terminam SEMPRE em RAISE EXCEPTION, que desfaz TUDO
-- (a migração e as fixtures): nada persiste. A mensagem é o relatório e tem
-- de ter "0 FALHA".
--
-- Fixtures relativas à data local L = (now() em America/Sao_Paulo)::date,
-- gravadas na convenção do engine (data local à meia-noite com sufixo Z),
-- por isso os testes valem a qualquer hora do dia, incluindo 21:00–24:00
-- locais (onde a vista antiga falhava).
-- ============================================================================
do $t$
declare
  v_confirm text := '__AMBIENTE__';
  L date := (current_timestamp at time zone 'America/Sao_Paulo')::date;
  ok int := 0; falha int := 0; rel text := '';
  v_cols text; v_inv boolean; n int;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid;

begin
  if v_confirm is distinct from 'staging' then
    raise exception 'RECUSA: v_confirm tem de ser staging';
  end if;
  if pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_viewdef('public.active_activities'::regclass)), 'america/sao_paulo') = 0 then
    raise exception 'RECUSA: a 0029 não está aplicada nesta transacção (colar a migração antes destes testes)';
  end if;

  insert into public.activities (title, source_key, recurrence_type, start_date, end_date)
    values ('zz-0029 T1 pontual hoje', 'qa-0029', 'none', (L::timestamp at time zone 'UTC'), null) returning id into t1;
  insert into public.activities (title, source_key, recurrence_type, start_date, end_date)
    values ('zz-0029 T2 pontual ontem', 'qa-0029', 'none', ((L - 1)::timestamp at time zone 'UTC'), null) returning id into t2;
  insert into public.activities (title, source_key, recurrence_type, start_date, end_date)
    values ('zz-0029 T3 pontual amanhã', 'qa-0029', 'none', ((L + 1)::timestamp at time zone 'UTC'), null) returning id into t3;
  insert into public.activities (title, source_key, recurrence_type, recurrence_days, end_date)
    values ('zz-0029 T4 semanal termina hoje', 'qa-0029', 'weekly', '{1}', (L::timestamp at time zone 'UTC')) returning id into t4;
  insert into public.activities (title, source_key, recurrence_type, recurrence_days, end_date)
    values ('zz-0029 T5 semanal terminou ontem', 'qa-0029', 'weekly', '{1}', ((L - 1)::timestamp at time zone 'UTC')) returning id into t5;
  insert into public.activities (title, source_key, recurrence_type, start_date, end_date)
    values ('zz-0029 T6 pontual hoje 23:00 local', 'qa-0029', 'none',
            (L::timestamp + interval '23 hours') at time zone 'UTC', (L::timestamp + interval '23 hours') at time zone 'UTC') returning id into t6;

  -- Visibilidade
  select count(*) into n from public.active_activities where id = t1; if n = 1 then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:T1-hoje-visivel'; end if;
  select count(*) into n from public.active_activities where id = t2; if n = 0 then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:T2-ontem-oculto'; end if;
  select count(*) into n from public.active_activities where id = t3; if n = 1 then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:T3-amanha-visivel'; end if;
  select count(*) into n from public.active_activities where id = t4; if n = 1 then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:T4-termina-hoje-visivel'; end if;
  select count(*) into n from public.active_activities where id = t5; if n = 0 then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:T5-terminou-ontem-oculto'; end if;
  select count(*) into n from public.active_activities where id = t6; if n = 1 then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:T6-hoje-23h-visivel'; end if;

  -- Expressão da data local, determinística (independente da hora a que se corre):
  -- é a MESMA expressão da vista, avaliada em instantes fixos.
  if ((timestamptz '2026-12-24 23:59:00+00' at time zone 'America/Sao_Paulo')::date = date '2026-12-24') then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:E1-20h59-local'; end if;
  if ((timestamptz '2026-12-25 00:00:00+00' at time zone 'America/Sao_Paulo')::date = date '2026-12-24') then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:E2-21h00-local(UTC ja e 25)'; end if;
  if ((timestamptz '2026-12-25 02:59:59+00' at time zone 'America/Sao_Paulo')::date = date '2026-12-24') then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:E3-23h59-local'; end if;
  if ((timestamptz '2026-12-25 03:00:00+00' at time zone 'America/Sao_Paulo')::date = date '2026-12-25') then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:E4-00h00-local'; end if;
  -- E5: às 22:00 locais de 24/12 um evento pontual de 24/12 passa no filtro novo e NÃO passava no antigo
  if ((timestamp '2026-12-24 23:00:00' at time zone 'UTC') >= (timestamptz '2026-12-25 01:00:00+00' at time zone 'America/Sao_Paulo')::date
      and not ((timestamp '2026-12-24 23:00:00' at time zone 'UTC') >= (timestamptz '2026-12-25 01:00:00+00')::date))
    then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:E5-evento-22h-local'; end if;

  -- Superconjunto: tudo o que o filtro antigo (CURRENT_DATE UTC) mostrava continua visível
  select count(*) into n from public.activities a
   where (a.end_date is null or a.end_date >= current_date)
     and (a.recurrence_type is not null and a.recurrence_type <> 'none' or a.recurrence_type = 'none' and a.start_date >= current_date)
     and not exists (select 1 from public.active_activities v where v.id = a.id);
  if n = 0 then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:superconjunto(' || n || ')'; end if;

  -- Estrutura e privilégios preservados
  select string_agg(a.attname, ',' order by a.attnum) into v_cols from pg_catalog.pg_attribute a
   where a.attrelid = 'public.active_activities'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_cols = 'id,title,description,category,venue_id,schedule,price,is_free,imagem_url,is_sponsored,created_at,start_date,end_date,recurrence_type,recurrence_days,recurrence_time,phone,url,interested_count'
    then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:colunas'; end if;
  select coalesce('security_invoker=true' = any(c.reloptions), false) into v_inv from pg_catalog.pg_class c where c.oid = 'public.active_activities'::regclass;
  if v_inv then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:security_invoker'; end if;
  -- ACL, dono e opções iguais ao estado antes da migração (guardado pelo P1)
  if pg_catalog.to_regclass('pg_temp._m0029_pre') is null then
    falha := falha + 1; rel := rel || ' FALHA:sem-estado-anterior(colar a 0029 na mesma transaccao)';
  elsif exists (select 1 from _m0029_pre p, pg_catalog.pg_class c
                 where c.oid = 'public.active_activities'::regclass
                   and p.acl is not distinct from c.relacl::text
                   and p.owner = c.relowner::regrole::text
                   and p.opts is not distinct from c.reloptions::text) then
    ok := ok + 1;
  else
    falha := falha + 1; rel := rel || ' FALHA:acl/dono/opcoes-alterados';
  end if;
  if has_table_privilege('anon', 'public.active_activities', 'SELECT') and has_table_privilege('authenticated', 'public.active_activities', 'SELECT')
     and not has_table_privilege('anon', 'public.active_activities', 'INSERT') and not has_table_privilege('authenticated', 'public.active_activities', 'UPDATE')
    then ok := ok + 1; else falha := falha + 1; rel := rel || ' FALHA:privilegios'; end if;

  raise exception 'TESTES 0029 (data local %, data UTC %): % OK, % FALHA%  — nada persistiu', L, current_date, ok, falha, rel;
end
$t$;
