-- ============================================================
-- Vivere Engine — Fase 3, migration 0001 (adaptada para Caminho A)
-- Coexistência com o schema atual do app Vivere 60+
--
-- CONTEXTO DESTA ADAPTAÇÃO:
-- O banco dev já contém o schema real do app Vivere 60+:
--   public.venues       (11 registros — venues do app)
--   public.activities   (21 registros — atividades do app)
--   public.favorites, public.activity_interests, public.suggestions,
--   public.partners, public.categories
--
-- Essas tabelas NÃO são tocadas, renomeadas, alteradas ou removidas
-- por esta migration. O schema atual do app é preservado integralmente.
--
-- O que esta migration cria:
--   - Camada A (dado bruto): staging.raw_venue_items,
--     staging.raw_activity_items
--   - Camada B (staging/curadoria): staging.venues_staging,
--     staging.activities_staging
--   - Infraestrutura de suporte: public.products, public.sources,
--     staging.ingestion_runs
--   - Proveniência: public.venue_contributions
--     (referencia uma futura tabela de venues da engine, ainda não
--     existente — ver nota abaixo)
--
-- O que INTENCIONALMENTE não é criado nesta migration:
--   - public.venues     → já existe no schema do app, não colidir
--   - public.activities → já existe no schema do app, não colidir
--   - public.venue_contributions (referencia public.venues da engine)
--   - public.activity_source_links (referencia public.activities engine)
--
-- INTEGRAÇÃO FUTURA:
-- Quando o schema do app for migrado para o modelo da Vivere Engine
-- (Caminho B, decisão futura), as seguintes tabelas serão criadas
-- numa migration separada:
--   - public.venue_contributions (FK → public.venues da engine)
--   - public.activity_source_links (FK → public.activities da engine)
-- E as FKs de promoção em staging (promoted_venue_id,
-- promoted_activity_id) serão adicionadas também via ALTER TABLE,
-- apontando para as entidades consolidadas da engine.
-- Por ora, esses campos existem como uuid nullable sem FK — ocupam
-- espaço mínimo, não causam erro, e estarão prontos para receber
-- a FK quando a migração do schema do app acontecer.
--
-- Princípios que permanecem válidos mesmo na versão adaptada:
--   1. Dado bruto (raw_*) é permanente e append-only após INSERT.
--   2. staging referencia o bruto por FK, nunca copia campos.
--   3. Nenhuma promoção automática — todos os campos de status
--      têm default 'pending_review'.
--   4. Nenhuma alteração no schema existente do app.
-- ============================================================

create schema if not exists staging;


-- ============================================================
-- PRODUCT — dimensão de particionamento lógico da plataforma.
-- Não existia no schema anterior do app (sem colisão).
-- ============================================================

create table public.products (
  product_key   text primary key,
  display_name  text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.products is
  'Dimensão de particionamento lógico da plataforma Vivere. Referenciada por product_key nas tabelas da engine. Não interfere com o schema atual do app (favorites, activity_interests, etc.), que não usa product_key.';


-- ============================================================
-- SOURCE — espelho em banco da configuração de instância que
-- já existe em TypeScript (collectors/*/config/*.ts).
-- Não existia no schema anterior do app (sem colisão).
-- ============================================================

create table public.sources (
  source_key       text primary key,
  display_name     text not null,
  product_key      text not null references public.products(product_key),
  source_priority  integer not null,
  source_kind      text not null check (source_kind in ('venue_authority', 'activity_authority')),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

comment on table public.sources is
  'Espelho em banco da configuração de Source (collectors/*/config/*.ts). source_kind distingue fontes que produzem RawVenueItem (venue_authority) de fontes que produzem RawActivityItem (activity_authority).';


-- ============================================================
-- INGESTION_RUN — entidade operacional de processo.
-- Não existia no schema anterior do app (sem colisão).
-- Política de retenção/expurgo: decisão operacional pendente.
-- ============================================================

create table staging.ingestion_runs (
  id               uuid primary key default gen_random_uuid(),
  source_key       text not null references public.sources(source_key),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running'
                     check (status in ('running', 'success', 'partial', 'failed')),
  items_collected  integer not null default 0,
  items_errored    integer not null default 0
);

comment on table staging.ingestion_runs is
  'Uma execução de coleta. Nasce no início, fecha no fim, nunca muda depois de finished_at preenchido. Política de retenção/expurgo: decisão operacional pendente.';


-- ============================================================
-- CAMADA A — DADO BRUTO PERSISTENTE
--
-- Materializa em banco os contratos RawVenueItem e RawActivityItem
-- (src/types/RawVenueItem.ts, src/types/RawActivityItem.ts).
-- Permanente: nenhuma linha sofre UPDATE após o INSERT inicial.
-- Não colidem com nada do schema atual do app.
-- ============================================================

create table staging.raw_venue_items (
  id                      uuid primary key default gen_random_uuid(),
  ingestion_run_id        uuid not null references staging.ingestion_runs(id),
  source_key              text not null references public.sources(source_key),
  source_item_id          text not null,
  collected_at            timestamptz not null,

  name                    text not null,
  address                 text,
  lat                     double precision,
  lng                     double precision,
  phone                   text,
  website                 text,
  opening_hours_raw       text,
  image_url               text,

  source_category_hint    text,
  source_query_text       text,
  source_query_kind       text check (source_query_kind in ('place_type', 'activity_intent')),

  google_types            text[] not null default '{}',
  google_business_status  text,

  raw_payload             jsonb not null,

  created_at              timestamptz not null default now(),

  unique (source_key, source_item_id, ingestion_run_id)
);

comment on table staging.raw_venue_items is
  'Camada A — materialização de RawVenueItem. Permanente e append-only: nunca sofre UPDATE após INSERT. Fonte de autoridade sobre LUGARES (ex: Google Places).';


create table staging.raw_activity_items (
  id                      uuid primary key default gen_random_uuid(),
  ingestion_run_id        uuid not null references staging.ingestion_runs(id),
  source_key              text not null references public.sources(source_key),
  source_item_id          text not null,
  collected_at            timestamptz not null,

  title                   text not null,
  description             text,
  raw_category_text       text,

  occurrences             jsonb not null default '[]',
  recurrence_text_hint    text,

  -- VenueMention: valor embutido, não entidade separada.
  -- Representa a AFIRMAÇÃO da fonte sobre o local — nunca um
  -- venue resolvido (isso é trabalho do Entity Resolution, futuro).
  venue_mention_raw_text          text,
  venue_mention_raw_address_text  text,
  venue_mention_confidence_hint   text
    check (venue_mention_confidence_hint in
      ('explicit_name', 'inferred_from_context', 'ambiguous')),

  price_text              text,
  is_free_hint            boolean,

  image_url               text,
  external_url            text,
  contact_phone           text,
  contact_email           text,

  language                text check (language in ('pt', 'en')),

  raw_payload             jsonb not null,

  created_at              timestamptz not null default now(),

  unique (source_key, source_item_id, ingestion_run_id)
);

comment on table staging.raw_activity_items is
  'Camada A — materialização de RawActivityItem. Permanente e append-only: nunca sofre UPDATE após INSERT. venue_mention_* é texto bruto da afirmação da fonte — nunca venue_id direto (resolução é responsabilidade futura do Entity Resolution).';


-- ============================================================
-- CAMADA B — STAGING
--
-- Espaço de trabalho para Entity Resolution e Human Review.
-- Não colidem com nada do schema atual do app.
--
-- NOTA SOBRE promoted_venue_id / promoted_activity_id:
-- Esses campos existem como uuid nullable SEM FK por ora.
-- Quando o Caminho B for executado (migração do schema do app
-- para o modelo da engine), a FK será adicionada via ALTER TABLE
-- apontando para public.venues / public.activities da engine.
-- Não apontam para as public.venues / public.activities atuais
-- do app — esses são modelos de dados diferentes.
-- ============================================================

create table staging.venues_staging (
  id                  uuid primary key default gen_random_uuid(),
  raw_venue_item_id   uuid references staging.raw_venue_items(id),
  product_key         text not null references public.products(product_key),

  proposal_status     text not null default 'pending_review'
                        check (proposal_status in
                          ('pending_review', 'approved', 'rejected', 'promoted')),

  -- FK para public.venues da engine (futura) — não adicionada agora
  -- porque public.venues atual pertence ao app, não à engine.
  -- Será adicionada via migration separada no Caminho B.
  promoted_venue_id   uuid,

  reviewed_by         text,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now()
);

comment on table staging.venues_staging is
  'Camada B — proposta de venue aguardando curadoria. promoted_venue_id é uuid nullable sem FK por ora: a tabela public.venues existente pertence ao schema atual do app. FK será adicionada quando o Caminho B (migração do schema do app) for executado.';


create table staging.activities_staging (
  id                          uuid primary key default gen_random_uuid(),
  raw_activity_item_id        uuid not null references staging.raw_activity_items(id),
  product_key                 text not null references public.products(product_key),

  venue_resolution_status     text not null default 'unresolved'
                                check (venue_resolution_status in
                                  ('unresolved', 'matched', 'proposed_new', 'ambiguous')),

  resolved_venue_staging_id   uuid references staging.venues_staging(id),
  resolution_confidence       numeric,

  proposal_status             text not null default 'pending_review'
                                check (proposal_status in
                                  ('pending_review', 'approved', 'rejected', 'promoted')),

  -- FK para public.activities da engine (futura) — não adicionada agora
  -- pelo mesmo motivo de promoted_venue_id acima.
  promoted_activity_id        uuid,

  reviewed_by                 text,
  reviewed_at                 timestamptz,
  created_at                  timestamptz not null default now()
);

comment on table staging.activities_staging is
  'Camada B — atividade em curadoria. promoted_activity_id é uuid nullable sem FK por ora: a tabela public.activities existente pertence ao schema atual do app, não à engine. venue_resolution_status é cidadão de primeira classe — Human Review opera diretamente sobre ele.';


-- ============================================================
-- ÍNDICES
-- ============================================================

create index idx_activities_staging_pending_review
  on staging.activities_staging (product_key, proposal_status)
  where proposal_status = 'pending_review';

create index idx_venues_staging_pending_review
  on staging.venues_staging (product_key, proposal_status)
  where proposal_status = 'pending_review';


-- ============================================================
-- TABELAS ADIADAS — criadas em migration futura (Caminho B)
-- ============================================================
--
-- As tabelas abaixo fazem parte do modelo conceitual aprovado mas
-- não podem ser criadas agora porque dependem de public.venues e
-- public.activities da engine (que não existem ainda — as tabelas
-- com esses nomes no banco pertencem ao schema atual do app):
--
--   public.venue_contributions
--     → references public.venues(id)  [engine, não app]
--
--   public.activity_source_links
--     → references public.activities(id)  [engine, não app]
--
-- Quando o Caminho B for executado, uma migration dedicada criará
-- essas duas tabelas, adicionará as FKs de promoted_venue_id e
-- promoted_activity_id em staging, e tratará a transição dos dados
-- existentes do app para o modelo da engine.
-- ============================================================
