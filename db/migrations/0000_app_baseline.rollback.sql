-- ============================================================
-- 0000 — Rollback do Baseline do Schema Legado
--
-- *** BOOTSTRAP ONLY — NEVER APPLY TO EXISTING PRODUCTION ***
--
-- Reverte 0000_app_baseline.sql. Só faz sentido num ambiente onde
-- 0000-0019(-0020) foram aplicados para bootstrap (ex: staging) —
-- NUNCA correr isto contra produção, onde estes objectos nunca foram
-- criados por esta migração.
--
-- Ordem: views antes de tabelas; tabelas dependentes antes de tabelas
-- referenciadas. Nunca usa CASCADE amplo — cada DROP é explícito,
-- falha ruidosamente se alguma dependência inesperada existir (sinal
-- de que algo mudou desde o baseline, a investigar, nunca a ignorar
-- silenciosamente com CASCADE).
-- ============================================================

drop view if exists public.active_activities;
drop view if exists public.users;

drop table if exists public.activity_interests;
drop table if exists public.favorites;
drop table if exists public.suggestions;
drop table if exists public.partners;
drop table if exists public.categories;
drop table if exists public.activities;
drop table if exists public.venues;

-- auth.users NUNCA é tocado aqui — gerido inteiramente pelo Supabase.
