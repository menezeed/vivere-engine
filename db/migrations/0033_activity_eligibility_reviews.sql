-- ============================================================
-- 0033 — Revisões humanas de elegibilidade 60+ (Issue #62, piloto UK)
--
-- CONTEXTO:
-- As actividades de fontes novas (FiSH, curadoria) não estão no dataset
-- auditado da u3a: no Admin aparecem "Sem auditoria" e a guarda 403 impede
-- aprová-las. Esta tabela guarda a CLASSIFICAÇÃO FUNDAMENTADA de um revisor
-- (evidência, URL oficial, data de verificação…), com trilha de auditoria.
--
-- NATUREZA: aditiva, numa transacção. Cria 1 tabela + 1 índice. NÃO altera,
-- não apaga e não lê dados de nenhuma tabela existente (só a FK aponta para
-- staging.activities_staging, que fica igual). Append-only: cada revisão é
-- uma linha nova (a última prevalece); o runtime não tem UPDATE nem DELETE.
--
-- PRIVILÉGIOS (menor privilégio, mesmo modelo da 0019; Postgres 17):
--   service_role: SELECT, INSERT. TRUNCATE, UPDATE, DELETE, REFERENCES,
--   TRIGGER e MAINTAIN revogados explicitamente (o schema staging não tem
--   default ACL; os REVOKE são defensivos e idempotentes).
--   anon/authenticated/PUBLIC: nenhum privilégio. RLS activo SEM políticas:
--   só papéis com BYPASSRLS (service_role, postgres) acedem.
--
-- EFEITO NAS ACTIVIDADES EXISTENTES: nenhum. A FK (ON DELETE NO ACTION)
-- só impede apagar uma actividade que JÁ tenha revisões (protege a trilha):
-- os rollbacks de ingestão falham com erro de FK nesse caso, sem apagar nada.
--
-- GUARDA: recusa se não for o projecto de staging do piloto UK (marcador:
-- primeira run da u3a, id e hora exactos, que só existe no staging).
--
-- AMBIENTE: só staging. NÃO aplicar em produção.
-- Rollback: 0033_activity_eligibility_reviews.rollback.sql.
-- ============================================================

begin;

do $guard_0033$
begin
  if not exists (
    select 1 from staging.ingestion_runs r
    where r.id = 'd2fcdb9e-bb12-4cd3-8bda-f92836d4ee90'
      and r.source_key = 'u3a_richmond'
      and r.started_at = '2026-11-26 10:25:06.953671+00'
  ) then
    raise exception 'RECUSA 0033: marcador do staging ausente — este não é o projecto de staging do piloto UK';
  end if;
end
$guard_0033$;

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
  -- Nota: o motor de regex do Postgres limita repetições a 255; o tamanho vai à parte.
  evidence_url         text not null check (evidence_url ~ '^https://[^[:space:]]+$' and char_length(evidence_url) between 12 and 500),
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
revoke truncate, update, delete, references, trigger, maintain on staging.activity_eligibility_reviews from service_role;
grant select, insert on staging.activity_eligibility_reviews to service_role;

commit;
