-- ============================================================
-- 0033 — Revisões humanas de elegibilidade 60+ (Issue #62, piloto UK)
--
-- CONTEXTO:
-- As actividades de fontes novas (FiSH, curadoria) não estão no dataset
-- auditado da u3a: no Admin aparecem "Sem auditoria" e a guarda 403 impede
-- aprová-las. Esta tabela guarda a CLASSIFICAÇÃO FUNDAMENTADA de um revisor
-- (evidência, URL oficial, data de verificação…), com trilha de auditoria.
--
-- NATUREZA: aditiva. Cria 1 tabela + 1 índice; não altera nem lê dados
-- existentes. Append-only: cada nova revisão é uma linha nova (a última
-- prevalece); não há UPDATE nem DELETE para o runtime.
--
-- PRIVILÉGIOS (menor privilégio, mesmo modelo da 0019):
--   service_role: SELECT, INSERT (sem UPDATE/DELETE); TRUNCATE revogado
--   explicitamente nesta tabela (dívida de hardening registada na 0019).
--   anon/authenticated: nenhum privilégio. RLS activo sem políticas
--   (service_role tem BYPASSRLS; nenhum outro papel lê).
--
-- AMBIENTE: só staging (piloto UK). NÃO aplicar em produção sem
-- autorização própria. Rollback: 0033_activity_eligibility_reviews.rollback.sql.
-- ============================================================

create table if not exists staging.activity_eligibility_reviews (
  id                   uuid primary key default gen_random_uuid(),
  activity_staging_id  uuid not null references staging.activities_staging(id),
  -- Chave da actividade no momento da revisão (para detectar revisões obsoletas)
  product_key          text not null,
  source_key           text not null,
  source_item_id       text not null,
  external_url         text,
  -- Classificação fundamentada
  classification       text not null check (classification in ('confirmed_60plus','likely_suitable','unclear','unsuitable')),
  confidence           text not null check (confidence in ('high','medium_high','medium','low')),
  evidence_text        text not null check (char_length(evidence_text) between 20 and 2000),
  evidence_url         text not null check (evidence_url ~ '^https://[^\s]{4,490}$'),
  audience             text check (audience is null or char_length(audience) <= 300),
  membership_required  boolean,
  booking              text check (booking is null or char_length(booking) <= 300),
  availability         text not null check (availability in ('open','waiting_list','closed','unknown')),
  additional_costs     text check (additional_costs is null or char_length(additional_costs) <= 300),
  verified_at          date not null,
  notes                text check (notes is null or char_length(notes) <= 1000),
  -- Trilha de auditoria
  reviewed_by          text not null check (char_length(reviewed_by) between 1 and 200),
  reviewed_role        text not null check (reviewed_role in ('reviewer','admin')),
  reviewed_at          timestamptz not null default now(),
  check (verified_at <= (reviewed_at at time zone 'UTC')::date)
);

create index if not exists activity_eligibility_reviews_activity_idx
  on staging.activity_eligibility_reviews (activity_staging_id, reviewed_at desc);

alter table staging.activity_eligibility_reviews enable row level security;

revoke all on staging.activity_eligibility_reviews from public, anon, authenticated;
revoke truncate, update, delete, references, trigger on staging.activity_eligibility_reviews from service_role;
grant select, insert on staging.activity_eligibility_reviews to service_role;
