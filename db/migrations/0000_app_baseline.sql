-- ============================================================
-- 0000 — Baseline do Schema Legado da App Vivere 60+
--
-- *** BOOTSTRAP ONLY — NEVER APPLY TO EXISTING PRODUCTION ***
--
-- Activity 16/26, Fase 16D (revista Fase 16E após divergência de ACL
-- descoberta em staging real). Esta migração NUNCA deve ser aplicada
-- ao projecto Supabase de produção real — esse projecto já contém
-- todos estes objectos, criados manualmente antes do Engine existir.
--
-- CORRECÇÃO 16E — ACL EXPLÍCITO, NÃO DEPENDENTE DE DEFAULT ACL:
-- A primeira versão desta migração (Fase 16D) criava tabelas/views
-- sem nenhum GRANT/REVOKE explícito, assumindo implicitamente que o
-- comportamento por omissão do Supabase seria suficiente. Bootstrap
-- real contra um projecto staging vazio revelou que isso é FALSO: o
-- default ACL configurado para a role `postgres` (a role que cria
-- estes objectos via SQL Editor/migração) concede só TRUNCATE/
-- REFERENCES/TRIGGER a anon/authenticated — nunca SELECT/INSERT/
-- UPDATE/DELETE, que produção tem via outro mecanismo nunca
-- documentado (provavelmente Table Editor do Dashboard, que corre
-- como supabase_admin, cujo default ACL é mais amplo).
--
-- Por isso, esta versão estabelece explicitamente o ACL canónico via
-- REVOKE + GRANT, para as relações onde há evidência directa e
-- suficiente do estado real de produção (Activity 16C.4):
--   - public.users (ZERO privilégios a anon/authenticated, confirmado)
--   - public.active_activities (todos os 7 privilégios, confirmado)
--   - public.activities (SELECT/INSERT/UPDATE/REFERENCES, confirmado
--     via role_column_grants; DELETE/TRUNCATE/TRIGGER permanecem
--     NÃO especificados aqui — sem evidência suficiente para os
--     reproduzir com confiança, ficam sujeitos ao default ACL, como
--     antes)
--
-- LACUNA CONHECIDA, NÃO RESOLVIDA NESTA MIGRAÇÃO: public.venues,
-- favorites, activity_interests, suggestions, partners, categories
-- NUNCA tiveram o seu ACL de produção confirmado directamente nesta
-- sessão (nem por role_table_grants nem por role_column_grants) —
-- continuam, por desenho, sem GRANT explícito aqui, sujeitas ao
-- default ACL da role que as criar. Isto é uma lacuna de evidência
-- genuína, registada explicitamente, não uma omissão silenciosa.
-- Antes de considerar esta Activity/Fase fechada, esta lacuna precisa
-- de ser investigada (consulta read-only a produção, autorizada
-- separadamente) e, se necessário, corrigida numa revisão futura
-- desta mesma migração.
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
  'Schema original da app Vivere 60+ (legado, pré-Engine). Reconstruído em 0000 a partir de evidência directa do catálogo de produção (Activity 16/26, Fase 16C.4) — nunca modificar o significado desta tabela sem evidência equivalente. ACL de produção NÃO confirmado directamente nesta sessão (ver cabeçalho) — lacuna conhecida.';

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

-- ACL explícito — evidência directa (role_column_grants, Activity
-- 15B): SELECT/INSERT/UPDATE/REFERENCES confirmados a anon e
-- authenticated. DELETE/TRUNCATE/TRIGGER deliberadamente NÃO
-- especificados — sem evidência suficiente, ficam ao default ACL.
revoke all on public.activities from anon, authenticated;
grant select, insert, update, references on public.activities
  to anon, authenticated;

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
--
-- ACL explícito — evidência directa (role_table_grants, Activity
-- 16C.4): ZERO privilégios confirmados para anon/authenticated em
-- produção. REVOKE explícito garante isto de forma determinística,
-- independente do default ACL de qualquer role que crie a view.
-- ------------------------------------------------------------
create view public.users as
select id, email,
  raw_user_meta_data ->> 'full_name' as display_name,
  created_at, last_sign_in_at
from auth.users;

revoke all on public.users from anon, authenticated;

-- ------------------------------------------------------------
-- public.active_activities — view sobre activities
--
-- SECURITY INVOKER preservado explicitamente (propriedade de segurança
-- já presente em produção, confirmada Activity 16/Fase 16C.4).
--
-- NÃO filtra product_key nem engine_status — comportamento idêntico
-- ao de produção, reproduzido tal como está, nunca "corrigido"
-- silenciosamente aqui.
--
-- ACL explícito — evidência directa (role_table_grants, Activity
-- 16C.4): TODOS os 7 privilégios (incluindo INSERT/UPDATE/DELETE,
-- nunca validados empiricamente) confirmados a anon/authenticated em
-- produção. Reproduzidos aqui deliberadamente, não corrigidos —
-- SECURITY VALIDATION REQUIRED BEFORE GO-LIVE, ver
-- scripts/active-activities-security-addendum.ts.
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

revoke all on public.active_activities from anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger
  on public.active_activities to anon, authenticated;
