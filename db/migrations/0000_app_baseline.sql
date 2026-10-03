-- ============================================================
-- 0000 — Baseline do Schema Legado da App Vivere 60+
--
-- *** BOOTSTRAP ONLY — NEVER APPLY TO EXISTING PRODUCTION ***
--
-- Activity 16/26, Fase 16D. Esta migração NUNCA deve ser aplicada ao
-- projecto Supabase de produção real — esse projecto já contém todos
-- estes objectos, criados manualmente antes do Engine existir (ver
-- cabeçalho de 0001_phase3_domain_model.sql, que já documentava isto
-- explicitamente: "O banco dev já contém o schema real do app Vivere
-- 60+... Essas tabelas NÃO são tocadas, renomeadas, alteradas ou
-- removidas por esta migration").
--
-- Esta migração existe só para permitir o bootstrap de um ambiente
-- NOVO E VAZIO (ex: staging) — reproduz, a partir de evidência directa
-- do catálogo ao vivo de produção (Activity 16, Fases 16C.2-16C.4,
-- nunca de memória nem de inferência a partir de código TypeScript), a
-- forma ORIGINAL do schema, tal como existia antes de qualquer
-- migração do Engine (0001-0018) ou de qualquer correcção de segurança
-- (0019).
--
-- NUNCA inclui:
--   - colunas engine_* (adicionadas por 0012/0013)
--   - RLS/políticas/funções/trigger de segurança (ver 0019)
--   - dados de produção
--
-- Ordem de dependência: products/sources (0001) referenciam nada
-- destas tabelas; activities referencia venues (FK); favorites e
-- activity_interests referenciam activities e auth.users; as views
-- referenciam activities e auth.users. auth.users é provisionado
-- automaticamente por qualquer projecto Supabase novo — nunca criado
-- aqui.
-- ============================================================

-- ------------------------------------------------------------
-- public.venues — forma original, sem campos engine_* (0012)
-- ------------------------------------------------------------
create table public.venues (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  address        text,
  category       text,
  lat            double precision,
  lng            double precision,
  created_at     timestamptz default now(),
  website        text,
  opening_hours  text,
  image_url      text,
  phone          text
);

comment on table public.venues is
  'Schema original da app Vivere 60+ (legado, pré-Engine). Reconstruído em 0000 a partir de evidência directa do catálogo de produção (Activity 16/26, Fase 16C.4) — nunca modificar o significado desta tabela sem evidência equivalente.';

-- ------------------------------------------------------------
-- public.activities — forma original, sem campos engine_* (0013)
-- ------------------------------------------------------------
create table public.activities (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text,
  category          text,
  venue_id          uuid references public.venues(id),
  schedule          text,
  price             numeric default 0,
  is_free           boolean default false,
  imagem_url        text,
  is_sponsored      boolean default false,
  created_at        timestamptz default now(),
  start_date        timestamptz,
  end_date          timestamptz,
  recurrence_type   text default 'none',
  recurrence_days   integer[],
  recurrence_time   text,
  phone             text,
  url               text,
  interested_count  integer default 0
);

comment on table public.activities is
  'Schema original da app Vivere 60+ (legado, pré-Engine). Mesma proveniência de public.venues — ver comentário acima.';

-- ------------------------------------------------------------
-- public.favorites
-- ------------------------------------------------------------
create table public.favorites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete cascade,
  created_at  timestamptz default now(),
  unique (user_id, activity_id)
);

-- ------------------------------------------------------------
-- public.activity_interests
-- ------------------------------------------------------------
create table public.activity_interests (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid references public.activities(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  device_id   text,
  created_at  timestamptz default now(),
  unique (activity_id, user_id),
  unique (activity_id, device_id)
);

-- ------------------------------------------------------------
-- public.suggestions
-- ------------------------------------------------------------
create table public.suggestions (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  location   text,
  schedule   text,
  phone      text,
  email      text,
  language   text default 'pt',
  status     text default 'pending',
  created_at timestamptz default now(),
  comment    text
);

-- ------------------------------------------------------------
-- public.partners
-- ------------------------------------------------------------
create table public.partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  logo_emoji  text,
  cor         text,
  url         text,
  coupon      text,
  discount    text,
  active      boolean default true,
  created_at  timestamptz default now()
);

-- ------------------------------------------------------------
-- public.categories
-- ------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  emoji      text not null,
  cor        text not null default '#1B6B45',
  label_pt   text not null,
  label_en   text not null,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- public.users — view sobre auth.users (nunca alterar auth.users)
-- Reproduzido tal como confirmado ao vivo: SEM GRANT a anon/
-- authenticated (a view existe mas não está exposta a nenhum cliente
-- hoje — reproduzir essa ausência de grant é a reconstrução segura,
-- não uma mudança deliberada).
-- ------------------------------------------------------------
create view public.users as
select id, email,
  raw_user_meta_data ->> 'full_name' as display_name,
  created_at, last_sign_in_at
from auth.users;

-- ------------------------------------------------------------
-- public.active_activities — view sobre activities
--
-- SECURITY INVOKER preservado explicitamente (propriedade de segurança
-- já presente em produção, confirmada Activity 16/Fase 16C.4).
--
-- NÃO filtra product_key nem engine_status — comportamento idêntico
-- ao de produção, reproduzido tal como está, nunca "corrigido"
-- silenciosamente aqui (qualquer correcção de filtro é uma mudança de
-- comportamento, fora do âmbito de reconstrução de baseline).
--
-- ACHADO DE SEGURANÇA NÃO RESOLVIDO AQUI (ver 0019 e
-- scripts/security-rls-validation.ts): esta view tem GRANT INSERT/
-- UPDATE/DELETE/TRUNCATE a anon/authenticated em produção, nunca
-- testado empiricamente. SECURITY VALIDATION REQUIRED BEFORE GO-LIVE
-- — ver scripts/security-rls-validation.ts, casos de teste
-- "via active_activities".
-- ------------------------------------------------------------
create view public.active_activities
with (security_invoker = true)
as
select id, title, description, category, venue_id, schedule, price,
  is_free, imagem_url, is_sponsored, created_at, start_date, end_date,
  recurrence_type, recurrence_days, recurrence_time, phone, url,
  interested_count
from public.activities
where (end_date is null or end_date >= current_date)
  and (recurrence_type is not null and recurrence_type <> 'none'
       or recurrence_type = 'none' and start_date >= current_date);
