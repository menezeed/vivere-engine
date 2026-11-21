#!/usr/bin/env bash
# ============================================================
# Runner SÓ LOCAL da 0032 (privilégio mínimo em categories, venues,
# partners e favorites). Bases descartáveis (prefixo obrigatório p32_),
# PostgreSQL local:
#   T1 fixture com o ACL da produção (auditoria A1, 21/11): anon tem os 8
#      privilégios; anon consegue TRUNCATE/INSERT; authenticated escolhe
#      created_at em favorites (o excesso existe)
#   T2 a 0032 recusa: papel errado, marcador prévio, opção de concessão,
#      privilégio a menos, entrada PUBLIC, privilégio de coluna prévio,
#      estado do staging (0023); o rollback recusa sem marcador e com
#      deriva; nada muda
#   T3 0032 aplica; ACL final exacto; o resto do catálogo não muda
#   T4 clientes: anon lê catálogo e é recusado em escrita/TRUNCATE e em
#      favorites; authenticated insere (user_id, activity_id), lê e apaga os
#      próprios favoritos; created_at/UPDATE/TRUNCATE recusados; admin
#      (app_metadata.role=admin) continua a escrever em categories/venues;
#      não-admin é recusado pelo RLS
#   T5 rollback → catálogo IGUAL à fixture; reaplicar; não idempotente
#   T6 composição com a W1 da produção: 0031 → 0030 → 0024 → 0025 → 0026 →
#      0029 → 0032 aplicam; o rollback de emergência 0026 continua a
#      funcionar depois da 0032; rollback 0032 → fixture
# Uso: PSQL=/caminho/psql PGHOST=127.0.0.1 PGPORT=<porta> P32_TMP=/dir \
#      run-0032-least-privilege.sh <prefixo p32_*> <raiz LF do repo engine>
# NUNCA apontar a um Supabase (staging/produção).
# ============================================================
set -u
export PGCLIENTENCODING=UTF8
PFX="${1:?prefixo p32_*}"; ENG="${2:?raiz do repo}"
printf '%s' "$PFX" | grep -qE '^p32_[a-z0-9_]{1,40}$' || { echo "Recusado: prefixo tem de ser p32_[a-z0-9_]+"; exit 2; }
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "Recusado: PGHOST tem de ser local"; exit 2;; esac
PSQL="${PSQL:-psql}"; T="${P32_TMP:?P32_TMP}"; mkdir -p "$T"
HERE="$ENG/db/audit/local"; M="$ENG/db/migrations"; SNAP="$HERE/lote3-catalog-snapshot.local.sql"
su() { "$PSQL" -U supabase_admin -X -q -v ON_ERROR_STOP=1 "$@"; }
pg() { local db="$1"; shift; "$PSQL" -U postgres -d "$db" -X -q -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAILS=0
ok()  { echo "PASS | $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL | $1"; FAILS=$((FAILS+1)); }
OUT=$(su -d postgres -Atc "select coalesce(string_agg(datname, ','), '') from pg_database where datname not in ('postgres', 'template0', 'template1') and datname !~ '^p32_'") || exit 1
[ -z "$OUT" ] || { echo "Recusado: o cluster tem bases que nao sao da simulacao: $OUT"; exit 2; }

newdb() { # base [template] -- nunca apaga: recusa nomes ja existentes
  printf '%s' "$1" | grep -qE '^p32_[a-z0-9_]+$' || { echo "Recusado: nome de base invalido $1"; exit 2; }
  if [ "$(su -d postgres -Atc "select count(*) from pg_database where datname = '$1'")" != "0" ]; then
    echo "Recusado: a base $1 ja existe (usar um prefixo novo)"; exit 2; fi
  if [ -n "${2:-}" ]; then su -d postgres -c "create database $1 template $2" >/dev/null || exit 1
  else
    su -d postgres -c "create database $1" >/dev/null || exit 1
    if [ "$(su -d postgres -Atc "select count(*) from pg_roles where rolname = 'anon'")" = "0" ]; then
      cp "$HERE/supabase-sim.sql" "$T/sim.sql"
    else
      grep -vE "^create role|^grant anon, authenticated, service_role to" "$HERE/supabase-sim.sql" > "$T/sim.sql"
    fi
    su -d "$1" -v dbname="$1" -f "$T/sim.sql" >/dev/null || exit 1
  fi
  su -d "$1" -c "alter database $1 set vivere.sim = 'local'" >/dev/null
}
chain() { # base até (inclusive)
  for f in $(ls "$M"/0*.sql | grep -v rollback | sort); do
    n=$(basename "$f" | cut -c1-4); [ "$n" \> "$2" ] && break
    pg "$1" -f "$f" >"$T/$1-$n.log" 2>&1 || { echo "FALHOU migração $(basename "$f") em $1"; cat "$T/$1-$n.log"; return 1; }
  done
}
snap() { su -d "$1" -At -f "$SNAP" > "$T/$2.snap" || bad "instantâneo $1"; }
same() { # descr snapA snapB [regex a ignorar]
  if [ -n "${4:-}" ]; then grep -vE "$4" "$T/$2.snap" > "$T/$2.f"; grep -vE "$4" "$T/$3.snap" > "$T/$3.f"; a="$T/$2.f"; b="$T/$3.f"
  else a="$T/$2.snap"; b="$T/$3.snap"; fi
  if diff -q "$a" "$b" >/dev/null; then ok "$1 ($(wc -l < "$a") factos iguais)"; else bad "$1"; diff "$a" "$b" | head -20; fi
}
apply_ok() { if pg "$2" -f "$3" >"$T/apply.log" 2>&1; then ok "$1"; else bad "$1"; cat "$T/apply.log"; fi; }
apply_abort() { # descr base ficheiro padrão [psql-user]
  snap "$2" before
  if "$PSQL" -U "${5:-postgres}" -d "$2" -X -q -v ON_ERROR_STOP=1 -f "$3" >"$T/apply.log" 2>&1; then bad "$1 (aplicou e devia abortar)"
  elif grep -q -- "$4" "$T/apply.log"; then
    snap "$2" after
    if diff -q "$T/before.snap" "$T/after.snap" >/dev/null; then ok "$1 -> $(grep -o 'ERROR: .*' "$T/apply.log" | head -1 | cut -c8-160)"
    else bad "$1 (abortou mas o catálogo mudou)"; fi
  else bad "$1 (erro inesperado)"; cat "$T/apply.log"; fi
}
# ACL das 4 tabelas para anon/authenticated/PUBLIC (tabela e coluna), ordenado
acl() {
  pg "$1" -At -c "
    select c.relname || '|' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '|' || a.privilege_type
           || '|' || pg_get_userbyid(a.grantor) || '|' || a.is_grantable
    from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.relnamespace = 'public'::regnamespace and c.relname in ('categories','venues','partners','favorites')
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon','authenticated'))
    union all
    select c.relname || '.' || att.attname || '|' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '|' || a.privilege_type
           || '|' || pg_get_userbyid(a.grantor) || '|' || a.is_grantable
    from pg_class c join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    cross join lateral aclexplode(att.attacl) a
    where c.relnamespace = 'public'::regnamespace and c.relname in ('categories','venues','partners','favorites')
      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon','authenticated'))
    order by 1" | tr -d '\r'
}
# Acção como cliente numa transacção desfeita. Devolve OK, "42501 permissao", "42501 rls" ou o erro.
UA=00000000-0000-4000-8000-00000000a001; UB=00000000-0000-4000-8000-00000000b002; UADM=00000000-0000-4000-8000-00000000ad01
as_client() { # base papel claims-json sql
  "$PSQL" -U postgres -d "$1" -X -At -v ON_ERROR_STOP=1 >"$T/cli.out" 2>&1 <<SQL
\set VERBOSITY verbose
begin;
select set_config('request.jwt.claims', '$3', true);
set local role $2;
$4;
rollback;
SQL
  local rc=$?
  if [ $rc -eq 0 ]; then echo OK
  elif grep -q "ERROR:  42501: permission denied" "$T/cli.out"; then echo "42501 permissao"
  elif grep -q "ERROR:  42501: new row violates row-level security" "$T/cli.out"; then echo "42501 rls"
  else grep -m1 "ERROR" "$T/cli.out" | tr -d '\r'; fi
}
expect() { # descr esperado base papel claims sql
  local r; r=$(as_client "$3" "$4" "$5" "$6")
  case "$2" in
    OK)   [ "$r" = "OK" ] && ok "$1" || bad "$1 (obtido: $r)";;
    DENY) [ "$r" = "42501 permissao" ] && ok "$1 (42501, privilégio)" || bad "$1 (obtido: $r)";;
    RLS)  [ "$r" = "42501 rls" ] && ok "$1 (42501, RLS)" || bad "$1 (obtido: $r)";;
  esac
}
# Contagem de linhas visíveis numa leitura como cliente
count_as() { # base papel claims sql -> número ou erro
  "$PSQL" -U postgres -d "$1" -X -At -q -v ON_ERROR_STOP=1 2>&1 <<SQL | tr -d '\r'
begin;
select set_config('request.jwt.claims', '$3', true) as cfg \gset
set local role $2;
$4;
rollback;
SQL
}

CA="{\"sub\":\"$UA\",\"role\":\"authenticated\"}"
CB="{\"sub\":\"$UB\",\"role\":\"authenticated\"}"
CADM="{\"sub\":\"$UADM\",\"role\":\"authenticated\",\"app_metadata\":{\"role\":\"admin\"}}"
CANON='{"role":"anon"}'

R22="${PFX}_ref22"; R23="${PFX}_ref23"; FX="${PFX}_fx"; W="${PFX}_w1"; X="${PFX}_x"
M32="$M/0032_prod_least_privilege_catalog_favorites.sql"; R32="$M/0032_prod_least_privilege_catalog_favorites.rollback.sql"

# Fixture: o ACL da produção nas 4 tabelas (auditoria A1 de 21/11: os 8
# privilégios de tabela, grantor postgres, sem opção) + dados de teste.
fixture_acl() {
  pg "$1" >/dev/null <<'SQL' || return 1
revoke all on public.categories, public.venues, public.partners, public.favorites from anon, authenticated, public;
grant select, insert, update, delete, truncate, references, trigger, maintain
  on public.categories, public.venues, public.partners, public.favorites to anon, authenticated;
SQL
}
fixture_data() {
  su -d "$1" >/dev/null <<SQL || return 1
insert into auth.users(id, email, raw_app_meta_data, email_confirmed_at) values
  ('$UA', 'a.p32@example.invalid', '{"provider":"email"}', now()),
  ('$UB', 'b.p32@example.invalid', '{"provider":"email"}', now()),
  ('$UADM', 'adm.p32@example.invalid', '{"provider":"email","role":"admin"}', now());
insert into public.venues(name) values ('P32 venue');
insert into public.activities(title, venue_id, start_date, recurrence_type, interested_count)
  select 'P32 actividade', id, now() + interval '7 days', 'none', 0 from public.venues where name = 'P32 venue';
insert into public.favorites(user_id, activity_id)
  select '$UB', id from public.activities where title = 'P32 actividade';
SQL
}
ACT="(select id from public.activities where title = 'P32 actividade')"

echo "== bases"
newdb "$R22"; chain "$R22" 0022 || exit 1
newdb "$R23"; chain "$R23" 0023 || exit 1
newdb "$FX" "$R22"; fixture_acl "$FX" || exit 1; fixture_data "$FX" || exit 1; snap "$FX" sfx; acl "$FX" > "$T/fx.acl"

echo "== T1 fixture (ACL da produção)"
[ "$(wc -l < "$T/fx.acl")" = "64" ] && ok "fixture: 4 tabelas x 2 papéis x 8 privilégios = 64 entradas" || bad "fixture: $(wc -l < "$T/fx.acl") entradas"
expect "antes: anon consegue INSERT de tabela em categories (só o RLS trava)" RLS "$FX" anon "$CANON" "insert into public.categories(key, emoji, label_pt, label_en) values ('p32x','x','x','x')"
expect "antes: anon tem TRUNCATE em partners (ignora o RLS)" OK "$FX" anon "$CANON" "truncate public.partners"
expect "antes: authenticated escolhe created_at nos favoritos (EXCESSO 4)" OK "$FX" authenticated "$CA" "insert into public.favorites(user_id, activity_id, created_at) select '$UA', id, now() - interval '400 days' from public.activities where title = 'P32 actividade'"

echo "== T2 a 0032 recusa estados errados"
apply_abort "0032 aborta no estado do staging (0023 aplicada)" "$R23" "$M32" "0032 abortada (P2"
apply_abort "rollback 0032 aborta na fixture (sem marcador)" "$FX" "$R32" "rollback 0032 abortado (R1): marcador"
apply_abort "0032 aborta fora do papel postgres" "$FX" "$M32" "0032 abortada (P1): correr como postgres" supabase_admin
newdb "${X}m" "$FX"; pg "${X}m" -c "comment on table public.favorites is 'outro'" >/dev/null
apply_abort "0032 aborta se favorites ja tiver comentario" "${X}m" "$M32" "favorites ja tem comentario"
newdb "${X}g" "$FX"; pg "${X}g" -c "grant select on public.venues to anon with grant option" >/dev/null
apply_abort "0032 aborta com opcao de concessao" "${X}g" "$M32" "com opcao de concessao"
newdb "${X}l" "$FX"; pg "${X}l" -c "revoke maintain on public.categories from authenticated" >/dev/null
apply_abort "0032 aborta com um privilegio a menos" "${X}l" "$M32" "em falta: categories authenticated MAINTAIN"
newdb "${X}u" "$FX"; pg "${X}u" -c "grant select on public.partners to public" >/dev/null
apply_abort "0032 aborta com entrada PUBLIC" "${X}u" "$M32" "inesperado: partners PUBLIC SELECT"
newdb "${X}k" "$FX"; pg "${X}k" -c "grant update (activity_id) on public.favorites to authenticated" >/dev/null
apply_abort "0032 aborta com privilegio de coluna previo" "${X}k" "$M32" "privilegio de coluna"
newdb "${X}r" "$FX"; pg "${X}r" -c "alter table public.partners disable row level security" >/dev/null
apply_abort "0032 aborta com RLS desligado" "${X}r" "$M32" "rls desligado em public.partners"

echo "== T3 0032 na fixture"
apply_ok "0032 aplica" "$FX" "$M32"; snap "$FX" sfx32; acl "$FX" > "$T/fx32.acl"
cat > "$T/esperado.acl" <<'EOF'
categories|anon|SELECT|postgres|false
categories|authenticated|DELETE|postgres|false
categories|authenticated|INSERT|postgres|false
categories|authenticated|SELECT|postgres|false
categories|authenticated|UPDATE|postgres|false
favorites.activity_id|authenticated|INSERT|postgres|false
favorites.user_id|authenticated|INSERT|postgres|false
favorites|authenticated|DELETE|postgres|false
favorites|authenticated|SELECT|postgres|false
partners|anon|SELECT|postgres|false
partners|authenticated|DELETE|postgres|false
partners|authenticated|INSERT|postgres|false
partners|authenticated|SELECT|postgres|false
partners|authenticated|UPDATE|postgres|false
venues|anon|SELECT|postgres|false
venues|authenticated|DELETE|postgres|false
venues|authenticated|INSERT|postgres|false
venues|authenticated|SELECT|postgres|false
venues|authenticated|UPDATE|postgres|false
EOF
sort "$T/esperado.acl" > "$T/esperado.s"; sort "$T/fx32.acl" > "$T/fx32.s"
if diff -q "$T/esperado.s" "$T/fx32.s" >/dev/null; then ok "ACL final exacto (19 entradas)"; else bad "ACL final"; diff "$T/esperado.s" "$T/fx32.s"; fi
same "o resto do catálogo não muda (excepto ACL/comentário das 4 tabelas)" sfx sfx32 '(categories|venues|partners|favorites)'
apply_abort "0032 não é idempotente (reaplicar aborta)" "$FX" "$M32" "0032 abortada (P1)"

echo "== T4 clientes depois da 0032"
expect "anon lê categories" OK "$FX" anon "$CANON" "select count(*) from public.categories"
expect "anon lê venues" OK "$FX" anon "$CANON" "select count(*) from public.venues"
expect "anon lê partners" OK "$FX" anon "$CANON" "select count(*) from public.partners"
expect "anon INSERT em categories recusado" DENY "$FX" anon "$CANON" "insert into public.categories(key, emoji, label_pt, label_en) values ('p32x','x','x','x')"
expect "anon UPDATE em venues recusado" DENY "$FX" anon "$CANON" "update public.venues set name = name"
expect "anon TRUNCATE em partners recusado" DENY "$FX" anon "$CANON" "truncate public.partners"
expect "anon sem acesso a favorites" DENY "$FX" anon "$CANON" "select count(*) from public.favorites"
expect "authenticated insere favorito (user_id, activity_id) como a app" OK "$FX" authenticated "$CA" "insert into public.favorites(user_id, activity_id) select '$UA', id from public.activities where title = 'P32 actividade'"
expect "authenticated não escolhe created_at (EXCESSO 4)" DENY "$FX" authenticated "$CA" "insert into public.favorites(user_id, activity_id, created_at) select '$UA', id, now() from public.activities where title = 'P32 actividade'"
expect "authenticated não escolhe id" DENY "$FX" authenticated "$CA" "insert into public.favorites(id, user_id, activity_id) select gen_random_uuid(), '$UA', id from public.activities where title = 'P32 actividade'"
expect "authenticated UPDATE em favorites recusado (EXCESSO 3)" DENY "$FX" authenticated "$CB" "update public.favorites set created_at = now()"
expect "authenticated TRUNCATE em favorites recusado" DENY "$FX" authenticated "$CB" "truncate public.favorites"
expect "authenticated apaga o próprio favorito" OK "$FX" authenticated "$CB" "delete from public.favorites where user_id = '$UB'"
n=$(count_as "$FX" authenticated "$CB" "select count(*) from public.favorites"); [ "$n" = "1" ] && ok "B vê o próprio favorito (1)" || bad "B vê $n favoritos"
n=$(count_as "$FX" authenticated "$CA" "select count(*) from public.favorites"); [ "$n" = "0" ] && ok "A não vê o favorito de B (RLS)" || bad "A vê $n favoritos"
expect "A não insere favorito em nome de B (RLS)" RLS "$FX" authenticated "$CA" "insert into public.favorites(user_id, activity_id) select '$UB', id from public.activities where title = 'P32 actividade'"
expect "admin continua a inserir em categories" OK "$FX" authenticated "$CADM" "insert into public.categories(key, emoji, label_pt, label_en) values ('p32adm','x','x','x')"
expect "admin continua a editar venues" OK "$FX" authenticated "$CADM" "update public.venues set name = name || '' where name = 'P32 venue'"
expect "admin continua a apagar em partners" OK "$FX" authenticated "$CADM" "delete from public.partners where false"
expect "não-admin recusado pelo RLS em categories" RLS "$FX" authenticated "$CA" "insert into public.categories(key, emoji, label_pt, label_en) values ('p32na','x','x','x')"
expect "authenticated TRUNCATE em categories recusado" DENY "$FX" authenticated "$CADM" "truncate public.categories"

echo "== T5 rollback"
newdb "${X}d" "$FX"; pg "${X}d" -c "grant update on public.favorites to authenticated" >/dev/null
apply_abort "rollback 0032 aborta com deriva depois da 0032" "${X}d" "$R32" "rollback 0032 abortado (R2"
newdb "${X}f" "$FX"; pg "${X}f" -c "comment on table public.favorites is 'vivere:0032 aplicada (falso)'" >/dev/null
apply_abort "rollback 0032 aborta com marcador forjado" "${X}f" "$R32" "rollback 0032 abortado (R1)"
apply_ok "rollback 0032 aplica" "$FX" "$R32"; snap "$FX" sfxrb
same "depois do rollback o catálogo é IGUAL à fixture" sfx sfxrb
acl "$FX" > "$T/fxrb.acl"; diff -q "$T/fx.acl" "$T/fxrb.acl" >/dev/null && ok "ACL igual à fixture (64 entradas)" || bad "ACL depois do rollback"
apply_ok "0032 reaplica depois do rollback" "$FX" "$M32"

echo "== T6 composição com a W1 da produção"
newdb "$W" "$R22"
if pg "$W" -f "$HERE/prod-acl-e2.fixture.local.sql" >/dev/null 2>"$T/w.err" && fixture_acl "$W" && fixture_data "$W"; then ok "fixture W1 da produção + ACL das 4 tabelas"; else bad "fixture W1"; cat "$T/w.err"; fi
for f in 0031_suggestions_insert_columns 0030_prod_interest_acl_baseline 0024_activity_interests_rpc 0025_delete_my_account 0026_legacy_interest_compat 0029_active_activities_local_date 0032_prod_least_privilege_catalog_favorites; do
  apply_ok "W1 produção: $f" "$W" "$M/$f.sql"
done
expect "depois da W1+0032: anon actualiza o contador (compat 0026)" OK "$W" anon "$CANON" "update public.activities set interested_count = interested_count + 1 where title = 'P32 actividade'"
expect "depois da W1+0032: RPC set_activity_interest como authenticated" OK "$W" authenticated "$CA" "select public.set_activity_interest($ACT, true)"
expect "depois da W1+0032: favorito da app" OK "$W" authenticated "$CA" "insert into public.favorites(user_id, activity_id) select '$UA', id from public.activities where title = 'P32 actividade'"
apply_ok "rollback de emergência 0026 continua a funcionar depois da 0032" "$W" "$M/0026_legacy_interest_compat.rollback.sql"
apply_ok "0026 reaplica (estado da W1)" "$W" "$M/0026_legacy_interest_compat.sql"
apply_ok "rollback 0032 na W1" "$W" "$R32"
apply_ok "rollback 0031 continua a funcionar" "$W" "$M/0031_suggestions_insert_columns.rollback.sql"

echo "TOTAL $PASS PASS, $FAILS FAIL"
[ "$FAILS" = "0" ]
