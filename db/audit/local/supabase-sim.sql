-- ============================================================
-- SIMULAÇÃO LOCAL do ambiente Supabase — SÓ PARA POSTGRESQL DESCARTÁVEL
-- REF: VIVERE-SEC-O-016B. NUNCA correr no Supabase (staging ou produção).
--
-- É uma SIMULAÇÃO, não uma reprodução: reproduz só o necessário para
-- validar db/migrations e db/audit (papéis, schema auth, auth.uid/jwt/
-- role, default ACL). Lacunas conhecidas: db/audit/README.md §4.
--
-- Correr como superutilizador local (supabase_admin), numa base vazia:
--   psql -U supabase_admin -d <base> -v ON_ERROR_STOP=1 -v dbname=<base> -f supabase-sim.sql
-- ============================================================

-- Marcador: scripts "só local" recusam correr sem isto.
alter database :"dbname" set vivere.sim = 'local';

-- Papéis com os atributos do Supabase. O `postgres` do Supabase NÃO é
-- superutilizador: é dono dos objectos, tem BYPASSRLS e é membro dos
-- papéis da API (por isso o SQL Editor pode fazer SET ROLE anon).
create role postgres login createrole createdb bypassrls;
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

grant create, connect, temporary on database :"dbname" to postgres;
alter schema public owner to postgres;
grant usage on schema public to anon, authenticated, service_role;

-- Default ACL dos objectos criados por `postgres`, tal como observado no
-- staging real (cabeçalho da 0000, Fase 16E; README da 0019): anon,
-- authenticated e service_role recebem só TRUNCATE, REFERENCES, TRIGGER
-- e MAINTAIN — nunca SELECT/INSERT/UPDATE/DELETE.
alter default privileges for role postgres
  grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;

-- Schema auth mínimo (no Supabase pertence a supabase_auth_admin).
create schema auth authorization supabase_admin;
create table auth.users (
  id                 uuid primary key,
  email              text,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now(),
  last_sign_in_at    timestamptz
);

-- Mesma lógica das funções do Supabase (leitura dos claims do PostgREST).
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role, postgres;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role, postgres;
grant select, references on auth.users to postgres;
