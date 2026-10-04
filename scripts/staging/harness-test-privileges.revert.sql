-- ============================================================
-- scripts/staging/harness-test-privileges.revert.sql
--
-- Reverte harness-test-privileges.sql. Aplicar logo depois de correr
-- o security harness no STAGING. NUNCA aplicar à produção.
--
-- Se esta reversão for esquecida, a validação de privilégios de
-- runtime (docs/runbooks/staging-bootstrap.md, secção 3) acusa
-- MISMATCH em partners e categories (esperados sem privilégios).
-- ============================================================

revoke delete on public.activities, public.venues from service_role;
revoke select, insert, delete on public.partners, public.categories from service_role;
