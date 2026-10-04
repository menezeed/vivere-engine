-- ============================================================
-- scripts/staging/harness-test-privileges.sql
--
-- Privilégios TEMPORÁRIOS e só de teste para o security harness
-- (scripts/security-rls-validation.ts e
-- scripts/active-activities-security-addendum.ts), que usa
-- service_role para criar, ler e apagar fixtures descartáveis em
-- public.activities, venues, partners e categories.
--
-- NUNCA aplicar à produção. NÃO faz parte da cadeia db/migrations:
-- não é runtime, e o runtime de service_role (0019) não inclui DELETE
-- nestas tabelas nem qualquer privilégio em partners e categories.
--
-- Aplicar imediatamente antes de correr o harness no STAGING e
-- reverter logo a seguir com harness-test-privileges.revert.sql.
-- Só concede o delta sobre o runtime: activities e venues já têm
-- SELECT, INSERT e UPDATE pela 0019.
-- ============================================================

grant delete on public.activities, public.venues to service_role;
grant select, insert, delete on public.partners, public.categories to service_role;
