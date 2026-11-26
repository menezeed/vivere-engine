-- ============================================================
-- Migration 0025 — Exclusão da própria conta (public.delete_my_account)
--
-- REF: Lote 2 (contrato v1.1, C2 + ajustes 1, 2, 3 e 5).
-- ESTADO: PROPOSTA, NÃO APLICADA em nenhum Supabase. Validada só na
-- simulação local (db/audit/local). Aplicar só com REF próprio, depois
-- da 0024.
--
-- public.delete_my_account() returns void
--   SECURITY DEFINER, dono postgres, `set search_path = ''`, nomes
--   qualificados; EXECUTE só para authenticated (revogado de PUBLIC, anon,
--   authenticated e service_role antes do GRANT, robusto ao default ACL
--   de funções do Supabase).
--
-- Do JWT só se usam auth.uid() (claim sub), o claim session_id e o claim
-- is_anonymous (sessões anónimas do Supabase Auth são recusadas). Tudo o
-- resto (papel gerido, e-mail, validade da sessão) vem de auth.users e
-- auth.sessions, fonte autoritativa.
--
-- PASSOS (por esta ordem; cada falha aborta sem apagar nada)
--   1. auth.uid() nulo, ou is_anonymous = true  -> 42501 not_authenticated
--   2. sessão recente (v1.1 item 1) ANTES de qualquer consulta que revele
--      se a conta existe ou é gerida: o claim session_id do JWT tem de ser
--      um uuid com linha em auth.sessions onde id = session_id,
--      user_id = auth.uid(), not_after nulo ou futuro e
--      created_at >= now() - 5 minutos (created_at = início da sessão no
--      login; o refresh do token só muda refreshed_at/updated_at, por
--      isso um token renovado de uma sessão antiga NÃO conta como
--      recente). Sem claim, claim inválido ou sem linha
--                                               -> 28000 reauthentication_required
--      (a app pede um login novo, que cria uma sessão nova).
--   3. auth.users sem linha para auth.uid()     -> P0002 user_not_found
--      (na prática inalcançável depois do passo 2: a sessão tem FK em
--      cascata para auth.users)
--   4. raw_app_meta_data->>'role' não nulo      -> 42501 account_managed
--      (contas de revisão/admin; geridas fora do app)
--   5. Anonimiza as sugestões do utilizador (v1.1 item 3), SÓ se o e-mail
--      da conta estiver confirmado (auth.users.email_confirmed_at não
--      nulo; um e-mail não confirmado não prova a posse e não pode servir
--      para anonimizar sugestões de outra pessoa): onde
--      lower(email) = lower(auth.users.email): email, phone e comment
--      ficam null; title, location, schedule, language, status e
--      created_at ficam. LIMITAÇÃO: suggestions não tem user_id; as
--      sugestões feitas sem login, com outro e-mail ou com e-mail não
--      confirmado não são ligáveis ao utilizador e ficam como estão.
--   6. delete from auth.users where id = auth.uid(): as FK em cascata
--      apagam favorites e activity_interests (0000) e as sessões,
--      identidades e refresh tokens do Auth.
--
-- CONTADOR: public.activities.interested_count NÃO é decrementado
-- quando a cascata apaga os interesses do utilizador (histórico
-- preservado e não auditado; ver 0024).
--
-- PRESSUPOSTO A CONFIRMAR NO STAGING ANTES DE APLICAR: o `postgres` do
-- Supabase pode ler auth.users/auth.sessions e apagar linhas de
-- auth.users (as FK do Auth em cascata correm com o dono das tabelas).
-- Se o DELETE falhar por privilégio, a função falha com 42501 e nada é
-- apagado (tudo numa transacção).
--
-- PRÉ-CONDIÇÕES (abortam tudo antes de qualquer alteração)
--  P1 0024 aplicada (set_activity_interest existe e a política compat
--     não existe); delete_my_account ausente (qualquer assinatura);
--     auth.users tem id, email, email_confirmed_at, raw_app_meta_data;
--     auth.sessions tem id, user_id, created_at, not_after;
--     public.suggestions tem email, phone, comment.
--  P2 FK de public.favorites e public.activity_interests para auth.users
--     com ON DELETE CASCADE; e nenhuma FK para auth.users fora do schema
--     auth com ON DELETE diferente de CASCADE ou SET NULL (senão o DELETE
--     falharia ou deixaria dados pessoais ligados a uma conta apagada).
--
-- Correr como `postgres`. NÃO é idempotente: reaplicar aborta em P1.
-- ROLLBACK: 0025_delete_my_account.rollback.sql.
-- ============================================================

begin;

do $pre$
declare
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    select '0024 nao aplicada (set_activity_interest ausente)' as p
    where pg_catalog.to_regprocedure('public.set_activity_interest(uuid, boolean)') is null
    union all
    select '0024 nao aplicada (politica compat_interested_count_update existe)'
    where exists (select 1 from pg_catalog.pg_policies
                  where schemaname = 'public' and tablename = 'activities'
                    and policyname = 'compat_interested_count_update')
    union all
    select 'funcao ja existe: public.delete_my_account(' || pg_catalog.pg_get_function_identity_arguments(f.oid) || ')'
    from pg_catalog.pg_proc f
    join pg_catalog.pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
    where f.proname = 'delete_my_account'
    union all
    select 'coluna em falta: ' || s || '.' || t || '.' || c
    from (values ('auth', 'users', 'id'), ('auth', 'users', 'email'), ('auth', 'users', 'raw_app_meta_data'),
                 ('auth', 'users', 'email_confirmed_at'),
                 ('auth', 'sessions', 'id'), ('auth', 'sessions', 'user_id'),
                 ('auth', 'sessions', 'created_at'), ('auth', 'sessions', 'not_after'),
                 ('public', 'suggestions', 'email'), ('public', 'suggestions', 'phone'),
                 ('public', 'suggestions', 'comment')) v(s, t, c)
    where not exists (select 1 from information_schema.columns ic
                      where ic.table_schema = v.s and ic.table_name = v.t and ic.column_name = v.c)
    union all
    select 'FK sem ON DELETE CASCADE para auth.users: public.' || t
    from unnest(array['favorites', 'activity_interests']) t
    where not exists (select 1 from pg_catalog.pg_constraint k
                      where k.conrelid = pg_catalog.to_regclass('public.' || t)
                        and k.confrelid = pg_catalog.to_regclass('auth.users')
                        and k.contype = 'f' and k.confdeltype = 'c')
    union all
    select 'FK para auth.users sem CASCADE/SET NULL: ' || k.conrelid::pg_catalog.regclass::text || '.' || k.conname
           || ' (on delete ' || k.confdeltype::text || ')'
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where k.contype = 'f'
      and k.confrelid = pg_catalog.to_regclass('auth.users')
      and n.nspname <> 'auth'
      and k.confdeltype not in ('c', 'n')
  ) x;
  if v_problems is not null then
    raise exception '0025 abortada (P1/P2): %', v_problems;
  end if;
end;
$pre$;

create function public.delete_my_account()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict error
declare
  v_uid       uuid := auth.uid();
  v_sid       text;
  v_email     text;
  v_confirmed boolean;
  v_role      text;
begin
  -- 1. sem sessão, ou sessão anónima do Supabase Auth
  if v_uid is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  -- 2. Sessão recente ANTES de revelar se a conta existe ou é gerida.
  -- Só o claim session_id vem do JWT; a validade vem de auth.sessions
  -- (created_at não muda com o refresh do token). IF separados: a ordem
  -- de avaliação de OR não é garantida e o cast para uuid de um claim
  -- inválido não pode chegar a correr.
  v_sid := auth.jwt() ->> 'session_id';
  if v_sid is null
     or v_sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = '28000', message = 'reauthentication_required';
  end if;
  if not exists (
       select 1
       from auth.sessions s
       where s.id = v_sid::uuid
         and s.user_id = v_uid
         and (s.not_after is null or s.not_after > pg_catalog.now())
         and s.created_at >= pg_catalog.now() - interval '5 minutes') then
    raise exception using errcode = '28000', message = 'reauthentication_required';
  end if;

  -- 3./4. conta existente e não gerida (fonte: auth.users, não o JWT)
  select u.email, u.email_confirmed_at is not null, u.raw_app_meta_data ->> 'role'
    into v_email, v_confirmed, v_role
  from auth.users u
  where u.id = v_uid;
  if not found then
    raise exception using errcode = 'P0002', message = 'user_not_found';
  end if;
  if v_role is not null then
    raise exception using errcode = '42501', message = 'account_managed';
  end if;

  -- 5. Sugestões ligáveis só por e-mail CONFIRMADO: anonimizar
  if v_email is not null and v_confirmed then
    update public.suggestions s
       set email = null, phone = null, comment = null
     where pg_catalog.lower(s.email) = pg_catalog.lower(v_email);
  end if;

  -- 6. Cascata: favorites, activity_interests, auth.sessions/identities/...
  delete from auth.users u where u.id = v_uid;
end;
$fn$;

alter function public.delete_my_account() owner to postgres;
revoke all on function public.delete_my_account() from public, anon, authenticated, service_role;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Lote 2 (0025): apaga a conta de auth.uid() (exige sessão com menos de 5 min em auth.sessions; recusa contas com app_metadata.role); anonimiza sugestões ligadas por e-mail.';

do $post$
declare
  v_problems text;
begin
  select string_agg(p, '; ') into v_problems from (
    select r || ' execute=' || pg_catalog.has_function_privilege(r, 'public.delete_my_account()', 'EXECUTE')::text as p
    from (values ('anon', false), ('authenticated', true), ('service_role', false)) v(r, want)
    where pg_catalog.has_function_privilege(r, 'public.delete_my_account()', 'EXECUTE') <> want
    union all
    select 'ACL/dono/config inesperados em delete_my_account'
    from pg_catalog.pg_proc f
    where f.oid = pg_catalog.to_regprocedure('public.delete_my_account()')
      and not (f.prosecdef and f.proconfig = array['search_path=""']
               and pg_catalog.pg_get_userbyid(f.proowner) = 'postgres'
               and array(select case when a.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee)::text end
                                || ':' || a.privilege_type
                         from pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
                         order by 1)
                   = array['authenticated:EXECUTE', 'postgres:EXECUTE'])
  ) x;
  if v_problems is not null then
    raise exception '0025 incompleta (verificacao final), transaccao desfeita: %', v_problems;
  end if;
end;
$post$;

commit;
