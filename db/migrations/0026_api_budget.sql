-- ============================================================
-- Migration 0026 — Orçamento persistente das APIs pagas
--                  (staging.api_budget_config, staging.api_usage_log
--                   e RPC reserve/confirm/release)
--
-- REF: L5 (desenho L5-BUDGET-DESENHO, 14/11/2026).
-- ESTADO: PROPOSTA, NÃO APLICADA em nenhum Supabase. Não testada em
-- PostgreSQL (não havia base local disponível). Aplicar só no STAGING
-- primeiro, com REF próprio, depois de rever db/audit/api-budget-
-- tests.staging.sql. NUMERAÇÃO: 0023–0025 vivem noutras branches e já
-- estão aplicadas no staging; esta é a seguinte.
--
-- CONTEXTO
-- Até aqui o BudgetRepo só existia em memória: cada execução dos
-- scripts ingest-* começava com gasto 0, por isso o "tecto mensal" era
-- na prática um tecto por execução, e "ler gasto → comparar → chamar →
-- registar" não era atómico. Esta migração cria o registo persistente e
-- a reserva atómica que tornam os tectos fiáveis entre execuções.
--
-- OBJECTOS
--   staging.api_budget_config  1 linha por fornecedor. Escrita SÓ pelo
--       operador/PO por SQL revisto (o Engine só lê). SEM linhas aqui:
--       os valores dos tectos são decisão do PO (exemplo em
--       scripts/staging/api_budget_config.seed.example.sql).
--   staging.api_usage_log  append-only: cada chamada paga nasce
--       'reserved'; a única alteração permitida é status
--       reserved → spent | released (trigger guard_api_usage_log).
--       DELETE e TRUNCATE recusados pelo trigger.
--   staging.reserve_api_budget(provider, call_type, run_key,
--       ingestion_run_id, estimated_cost_usd)
--       pg_advisory_xact_lock por fornecedor; soma reserved + spent no
--       mês, no dia e na execução (run_key); recusa ANTES da chamada se
--       hard_stop_enabled e algum tecto seria excedido; sem linha de
--       config → recusa (fail-closed, nunca um default implícito).
--   staging.confirm_api_spend(reservation_id)   reserved → spent
--   staging.release_api_budget(reservation_id)  reserved → released
--       (chamada falhou antes de ser cobrada)
--
-- FUSO: o mês e o dia de orçamento contam-se em UTC (budget_month e
-- budget_day calculados de now() at time zone 'UTC' pelo trigger, no
-- INSERT). Às 21:00 de Brasília já é o dia seguinte em UTC. Alternativa
-- (America/Sao_Paulo) é decisão do PO; mudaria só o trigger e a RPC.
--
-- DESVIOS DO DESENHO (L5-BUDGET-DESENHO §2)
--   * run_key uuid NOT NULL (novo): o tecto por execução precisa de um
--     identificador estável mesmo quando não há ingestion_run (o
--     Collector corre antes/independentemente dela); ingestion_run_id
--     fica como ligação opcional (FK) para auditoria.
--   * budget_month/budget_day são colunas normais preenchidas pelo
--     trigger (não generated): evita depender da volatilidade de
--     timezone() numa expressão gerada e impede que o cliente as forje.
--   * settled_at (novo): momento da passagem a spent/released.
--   * A RPC devolve também os tectos e os limiares de alerta, para o
--     Engine emitir alertas sem uma segunda leitura.
--
-- PRIVILÉGIOS: RLS ligado nas duas tabelas, sem políticas; tudo
-- revogado de PUBLIC, anon e authenticated (e de service_role antes de
-- conceder o mínimo, para não herdar TRUNCATE do default ACL).
-- service_role: SELECT na config; SELECT, INSERT e UPDATE(status) no log
-- (as RPC são SECURITY INVOKER; o trigger restringe o UPDATE à
-- transição permitida); EXECUTE nas 3 RPC.
--
-- RESERVAS ÓRFÃS: se o processo morrer entre reserve e confirm/release,
-- a linha fica 'reserved' e continua a contar para os tectos (erro do
-- lado seguro). A libertação manual é operação do operador.
--
-- PRÉ-CONDIÇÕES (abortam tudo antes de qualquer alteração)
--  P1 staging.ingestion_runs existe (0001); nenhum dos objectos desta
--     migração existe; papéis anon, authenticated e service_role existem.
--
-- Correr como `postgres`. NÃO é idempotente: reaplicar aborta em P1.
-- ROLLBACK: 0026_api_budget.rollback.sql (apaga o histórico de gasto).
-- ============================================================

begin;

do $pre$
declare
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    select 'staging.ingestion_runs nao existe (0001 em falta)' as p
    where pg_catalog.to_regclass('staging.ingestion_runs') is null
    union all
    select 'objecto ja existe: ' || o
    from unnest(array['staging.api_budget_config', 'staging.api_usage_log']) o
    where pg_catalog.to_regclass(o) is not null
    union all
    select 'funcao ja existe: staging.' || f.proname
    from pg_catalog.pg_proc f
    join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'staging'
    where f.proname in ('reserve_api_budget', 'confirm_api_spend', 'release_api_budget', 'guard_api_usage_log')
    union all
    select 'papel em falta: ' || r
    from unnest(array['anon', 'authenticated', 'service_role']) r
    where not exists (select 1 from pg_catalog.pg_roles x where x.rolname = r)
  ) x;
  if v_problems is not null then
    raise exception '0026 abortada (P1): %', v_problems;
  end if;
end;
$pre$;

-- ------------------------------------------------------------
-- Tabelas
-- ------------------------------------------------------------

create table staging.api_budget_config (
  provider              text primary key
                          check (provider ~ '^[a-z0-9][a-z0-9_-]*$'),
  monthly_budget_usd    numeric(10,4) not null check (monthly_budget_usd >= 0),
  daily_budget_usd      numeric(10,4)     null check (daily_budget_usd >= 0),
  per_run_budget_usd    numeric(10,4)     null check (per_run_budget_usd >= 0),
  hard_stop_enabled     boolean not null default true,
  alert_thresholds_pct  numeric[] not null default '{0.5,0.8,1.0}'
                          check (cardinality(alert_thresholds_pct) between 1 and 10
                                 and 0 < all (alert_thresholds_pct)),
  updated_at            timestamptz not null default now(),
  -- identificador operacional (ex.: 'operador-stg'), nunca um e-mail
  updated_by            text not null check (length(btrim(updated_by)) > 0 and updated_by !~ '@')
);

comment on table staging.api_budget_config is
  'L5 (0026): tectos de gasto por fornecedor de API paga. Escrita só pelo operador/PO por SQL revisto; o Engine só lê. Sem linha = recusa (fail-closed). Mês/dia em UTC.';

create table staging.api_usage_log (
  id                 bigint generated always as identity primary key,
  provider           text not null references staging.api_budget_config(provider),
  call_type          text not null check (length(btrim(call_type)) > 0),
  run_key            uuid not null,
  ingestion_run_id   uuid null references staging.ingestion_runs(id),
  estimated_cost_usd numeric(10,4) not null check (estimated_cost_usd >= 0),
  status             text not null default 'reserved'
                       check (status in ('reserved', 'spent', 'released')),
  reserved_at        timestamptz not null default now(),
  settled_at         timestamptz null,
  -- UTC: preenchidas pelo trigger no INSERT a partir de now()
  budget_month       date not null,
  budget_day         date not null,
  constraint api_usage_log_settled_consistent
    check ((status = 'reserved') = (settled_at is null))
);

comment on table staging.api_usage_log is
  'L5 (0026): registo append-only de chamadas pagas (reserva → spent|released). Só a transição de status é permitida (trigger guard_api_usage_log). budget_month/budget_day em UTC. Retenção: decisão operacional pendente.';

create index api_usage_log_provider_month on staging.api_usage_log (provider, budget_month) where status <> 'released';
create index api_usage_log_provider_day   on staging.api_usage_log (provider, budget_day)   where status <> 'released';
create index api_usage_log_run_key        on staging.api_usage_log (run_key)                where status <> 'released';
create index api_usage_log_ingestion_run  on staging.api_usage_log (ingestion_run_id)       where ingestion_run_id is not null;

-- ------------------------------------------------------------
-- Trigger append-only (mesmo padrão de guard_activities_update, 0020)
-- ------------------------------------------------------------

create function staging.guard_api_usage_log()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'reserved' then
      raise exception using errcode = '23514',
        message = 'api_usage_log: uma linha nova tem de nascer reserved';
    end if;
    new.reserved_at  := now();
    new.settled_at   := null;
    new.budget_month := date_trunc('month', now() at time zone 'UTC')::date;
    new.budget_day   := (now() at time zone 'UTC')::date;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.status <> 'reserved' or new.status not in ('spent', 'released') then
      raise exception using errcode = '23514',
        message = format('api_usage_log: transicao %s -> %s nao permitida (so reserved -> spent|released)',
                         old.status, new.status);
    end if;
    if (to_jsonb(new) - 'status' - 'settled_at') is distinct from (to_jsonb(old) - 'status' - 'settled_at') then
      raise exception using errcode = '23514',
        message = 'api_usage_log: so a coluna status pode ser alterada';
    end if;
    new.settled_at := now();
    return new;
  else
    -- DELETE (por linha) e TRUNCATE (por instrução)
    raise exception using errcode = '23514',
      message = format('api_usage_log: append-only, %s nao permitido', tg_op);
  end if;
end;
$$;

revoke all on function staging.guard_api_usage_log() from public;
revoke all on function staging.guard_api_usage_log() from anon, authenticated;

create trigger guard_api_usage_log
  before insert or update or delete on staging.api_usage_log
  for each row
  execute function staging.guard_api_usage_log();

create trigger guard_api_usage_log_truncate
  before truncate on staging.api_usage_log
  for each statement
  execute function staging.guard_api_usage_log();

-- ------------------------------------------------------------
-- RPC
-- ------------------------------------------------------------

create function staging.reserve_api_budget(
  p_provider            text,
  p_call_type           text,
  p_run_key             uuid,
  p_ingestion_run_id    uuid,
  p_estimated_cost_usd  numeric
)
returns table (
  allowed           boolean,
  reason            text,
  reservation_id    bigint,
  spent_month_usd   numeric,
  spent_day_usd     numeric,
  spent_run_usd     numeric,
  budget_month_usd  numeric,
  budget_day_usd    numeric,
  budget_run_usd    numeric,
  hard_stop         boolean,
  alert_thresholds  numeric[]
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_cfg       staging.api_budget_config%rowtype;
  v_month     date := date_trunc('month', now() at time zone 'UTC')::date;
  v_day       date := (now() at time zone 'UTC')::date;
  v_s_month   numeric;
  v_s_day     numeric;
  v_s_run     numeric;
  v_exceeded  text := null;
  v_id        bigint;
begin
  if p_provider is null or p_call_type is null or btrim(p_call_type) = ''
     or p_run_key is null or p_estimated_cost_usd is null or p_estimated_cost_usd < 0 then
    return query select false, 'invalid_arguments'::text, null::bigint,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::boolean, null::numeric[];
    return;
  end if;

  -- Serializa as reservas do mesmo fornecedor até ao fim da transacção.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('staging.api_budget:' || p_provider));

  select c.* into v_cfg from staging.api_budget_config c where c.provider = p_provider;
  if not found then
    return query select false, 'no_config'::text, null::bigint,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::boolean, null::numeric[];
    return;
  end if;

  select coalesce(sum(u.estimated_cost_usd) filter (where u.budget_month = v_month), 0),
         coalesce(sum(u.estimated_cost_usd) filter (where u.budget_day = v_day), 0),
         coalesce(sum(u.estimated_cost_usd) filter (where u.run_key = p_run_key), 0)
    into v_s_month, v_s_day, v_s_run
    from staging.api_usage_log u
   where u.provider = p_provider
     and u.status <> 'released'
     and (u.budget_month = v_month or u.run_key = p_run_key);

  if v_s_month + p_estimated_cost_usd > v_cfg.monthly_budget_usd then
    v_exceeded := 'monthly_cap';
  elsif v_cfg.daily_budget_usd is not null and v_s_day + p_estimated_cost_usd > v_cfg.daily_budget_usd then
    v_exceeded := 'daily_cap';
  elsif v_cfg.per_run_budget_usd is not null and v_s_run + p_estimated_cost_usd > v_cfg.per_run_budget_usd then
    v_exceeded := 'per_run_cap';
  end if;

  if v_exceeded is not null and v_cfg.hard_stop_enabled then
    -- Recusa ANTES da chamada paga: nada é inserido.
    return query select false, v_exceeded, null::bigint,
      v_s_month, v_s_day, v_s_run,
      v_cfg.monthly_budget_usd::numeric, v_cfg.daily_budget_usd::numeric, v_cfg.per_run_budget_usd::numeric,
      v_cfg.hard_stop_enabled, v_cfg.alert_thresholds_pct;
    return;
  end if;

  insert into staging.api_usage_log (provider, call_type, run_key, ingestion_run_id, estimated_cost_usd)
  values (p_provider, p_call_type, p_run_key, p_ingestion_run_id, p_estimated_cost_usd)
  returning id into v_id;

  -- Gasto devolvido JÁ inclui esta reserva. hard_stop desligado e tecto
  -- excedido: permitido, com reason 'soft_<tecto>' para o Engine avisar.
  return query select true,
    case when v_exceeded is null then null::text else 'soft_' || v_exceeded end,
    v_id,
    v_s_month + p_estimated_cost_usd, v_s_day + p_estimated_cost_usd, v_s_run + p_estimated_cost_usd,
    v_cfg.monthly_budget_usd::numeric, v_cfg.daily_budget_usd::numeric, v_cfg.per_run_budget_usd::numeric,
    v_cfg.hard_stop_enabled, v_cfg.alert_thresholds_pct;
end;
$$;

comment on function staging.reserve_api_budget(text, text, uuid, uuid, numeric) is
  'L5 (0026): reserva atómica (advisory lock por fornecedor) antes de uma chamada paga. Recusa sem config (no_config) ou com tecto excedido e hard_stop (monthly_cap/daily_cap/per_run_cap). Mês/dia em UTC.';

create function staging.confirm_api_spend(p_reservation_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update staging.api_usage_log u
     set status = 'spent'
   where u.id = p_reservation_id
     and u.status = 'reserved';
  if not found then
    raise exception using errcode = 'P0002',
      message = format('api_usage_log: reserva %s inexistente ou ja liquidada', p_reservation_id);
  end if;
end;
$$;

create function staging.release_api_budget(p_reservation_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update staging.api_usage_log u
     set status = 'released'
   where u.id = p_reservation_id
     and u.status = 'reserved';
  if not found then
    raise exception using errcode = 'P0002',
      message = format('api_usage_log: reserva %s inexistente ou ja liquidada', p_reservation_id);
  end if;
end;
$$;

-- ------------------------------------------------------------
-- RLS e privilégios
-- ------------------------------------------------------------

alter table staging.api_budget_config enable row level security;
alter table staging.api_usage_log     enable row level security;

revoke all on table staging.api_budget_config, staging.api_usage_log
  from public, anon, authenticated, service_role;

grant select on table staging.api_budget_config to service_role;
grant select, insert on table staging.api_usage_log to service_role;
grant update (status) on table staging.api_usage_log to service_role;

revoke all on function staging.reserve_api_budget(text, text, uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function staging.confirm_api_spend(bigint)  from public, anon, authenticated;
revoke all on function staging.release_api_budget(bigint) from public, anon, authenticated;

grant execute on function staging.reserve_api_budget(text, text, uuid, uuid, numeric) to service_role;
grant execute on function staging.confirm_api_spend(bigint)  to service_role;
grant execute on function staging.release_api_budget(bigint) to service_role;

-- ------------------------------------------------------------
-- Verificação final (desfaz tudo se algo não ficou como esperado)
-- ------------------------------------------------------------

do $post$
declare
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    select r || ' tem privilegio ' || priv || ' em ' || t as p
    from unnest(array['anon', 'authenticated']) r,
         unnest(array['staging.api_budget_config', 'staging.api_usage_log']) t,
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) priv
    where pg_catalog.has_table_privilege(r, t, priv)
    union all
    select 'service_role tem ' || priv || ' em ' || t
    from (values ('staging.api_budget_config', 'INSERT'), ('staging.api_budget_config', 'UPDATE'),
                 ('staging.api_budget_config', 'DELETE'), ('staging.api_budget_config', 'TRUNCATE'),
                 ('staging.api_usage_log', 'DELETE'), ('staging.api_usage_log', 'TRUNCATE')) v(t, priv)
    where pg_catalog.has_table_privilege('service_role', t, priv)
    union all
    select 'service_role sem ' || priv || ' em ' || t
    from (values ('staging.api_budget_config', 'SELECT'), ('staging.api_usage_log', 'SELECT'),
                 ('staging.api_usage_log', 'INSERT')) v(t, priv)
    where not pg_catalog.has_table_privilege('service_role', t, priv)
    union all
    select 'service_role sem UPDATE(status) em staging.api_usage_log'
    where not pg_catalog.has_column_privilege('service_role', 'staging.api_usage_log', 'status', 'UPDATE')
    union all
    select r || ' execute=' || pg_catalog.has_function_privilege(r, f, 'EXECUTE')::text || ' em ' || f
    from unnest(array['staging.reserve_api_budget(text, text, uuid, uuid, numeric)',
                      'staging.confirm_api_spend(bigint)',
                      'staging.release_api_budget(bigint)']) f,
         (values ('anon', false), ('authenticated', false), ('service_role', true)) v(r, want)
    where pg_catalog.has_function_privilege(r, f, 'EXECUTE') <> want
    union all
    select 'RLS desligado em ' || t
    from unnest(array['staging.api_budget_config', 'staging.api_usage_log']) t
    where not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = pg_catalog.to_regclass(t))
    union all
    select 'politica inesperada em ' || p.tablename || ': ' || p.policyname
    from pg_catalog.pg_policies p
    where p.schemaname = 'staging' and p.tablename in ('api_budget_config', 'api_usage_log')
    union all
    select 'linhas inesperadas em staging.api_budget_config'
    where exists (select 1 from staging.api_budget_config)
  ) x;
  if v_problems is not null then
    raise exception '0026 incompleta (verificacao final), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
