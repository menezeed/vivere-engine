#!/usr/bin/env bash
# ============================================================
# Runner SÓ LOCAL da 0031 (INSERT em suggestions só nas 6 colunas da app).
# Bases descartáveis (prefixo obrigatório p31_), PostgreSQL local, sobre a
# fixture do ACL da produção da E2 (prod-acl-e2.fixture.local.sql):
#   T1 fixture: o pré-voo tem os 2 EXCESSO de suggestions; anon consegue
#      hoje escolher created_at/id/schedule (o excesso existe)
#   T2 a 0031 recusa: estado do staging (0023 aplicada), opção de
#      concessão, comentário prévio, política diferente, privilégio de
#      coluna prévio; o rollback recusa sem marcador; nada muda
#   T3 0031 aplica; o pré-voo perde os 2 EXCESSO de suggestions e só eles;
#      MATRIZ continua vazia; o resto do catálogo não muda
#   T4 cliente: como anon e como authenticated, o INSERT da app (6
#      colunas, defaults) passa; com created_at, id, schedule ou status
#      → 42501; status continua 'pending'
#   T5 rollback → catálogo IGUAL ao da fixture; reaplicar; não idempotente
#   T6 composição com a W1: 0031 → 0030 → 0024 → 0025 → 0026 aplicam; o
#      INSERT da app continua a passar; MATRIZ vazia
# Uso: PSQL=/caminho/psql PGHOST=127.0.0.1 PGPORT=<porta> P31_TMP=/dir \
#      run-0031-suggestions.sh <prefixo p31_*> <raiz LF do repo engine>
# A raiz deve ser uma exportação LF (git -c core.autocrlf=false archive).
# NUNCA apontar a um Supabase (staging/produção).
# ============================================================
set -u
export PGCLIENTENCODING=UTF8
PFX="${1:?prefixo p31_*}"; ENG="${2:?raiz do repo}"
printf '%s' "$PFX" | grep -qE '^p31_[a-z0-9_]{1,40}$' || { echo "Recusado: prefixo tem de ser p31_[a-z0-9_]+"; exit 2; }
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "Recusado: PGHOST tem de ser local"; exit 2;; esac
PSQL="${PSQL:-psql}"; T="${P31_TMP:?P31_TMP}"; mkdir -p "$T"
HERE="$ENG/db/audit/local"; M="$ENG/db/migrations"; SNAP="$HERE/lote3-catalog-snapshot.local.sql"; PRE="$ENG/db/audit/prevoo-0023-0024.readonly.sql"
su() { "$PSQL" -U supabase_admin -X -q -v ON_ERROR_STOP=1 "$@"; }
pg() { local db="$1"; shift; "$PSQL" -U postgres -d "$db" -X -q -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAILS=0
ok()  { echo "PASS | $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL | $1"; FAILS=$((FAILS+1)); }
OUT=$(su -d postgres -Atc "select coalesce(string_agg(datname, ','), '') from pg_database where datname not in ('postgres', 'template0', 'template1') and datname !~ '^(p30|p31|l3c)_'") || exit 1
[ -z "$OUT" ] || { echo "Recusado: o cluster tem bases que nao sao da simulacao: $OUT"; exit 2; }

newdb() { # base [template] -- nunca apaga: recusa nomes ja existentes
  printf '%s' "$1" | grep -qE '^p31_[a-z0-9_]+$' || { echo "Recusado: nome de base invalido $1"; exit 2; }
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
apply_abort() { # descr base ficheiro padrão
  snap "$2" before
  if pg "$2" -f "$3" >"$T/apply.log" 2>&1; then bad "$1 (aplicou e devia abortar)"
  elif grep -q -- "$4" "$T/apply.log"; then
    snap "$2" after
    if diff -q "$T/before.snap" "$T/after.snap" >/dev/null; then ok "$1 -> $(grep -o 'ERROR: .*' "$T/apply.log" | head -1 | cut -c8-150)"
    else bad "$1 (abortou mas o catálogo mudou)"; fi
  else bad "$1 (erro inesperado)"; cat "$T/apply.log"; fi
}
preflight() {
  if su -d "$1" -At -F '|' -f "$PRE" > "$T/$2.raw" 2> "$T/$2.err"; then tr -d '\r' < "$T/$2.raw" | cut -d'|' -f2- | sort > "$T/$2.pre"
  else bad "pre-voo falhou em $1"; cat "$T/$2.err"; echo "TOTAL $PASS PASS, $FAILS FAIL"; exit 1; fi
}
# Insercao como cliente: devolve OK ou o SQLSTATE. Corre numa transaccao desfeita (nao deixa linhas).
ins() { # base papel colunas-extra-sql valores-extra-sql
  "$PSQL" -U postgres -d "$1" -X -At -v ON_ERROR_STOP=1 >"$T/ins.out" 2>&1 <<SQL
begin;
set local role $2;
insert into public.suggestions (title, location, phone, comment, email, language$3)
values ('Sugestao teste', 'Local', '000', null, 'teste@example.invalid', 'pt'$4);
rollback;
SQL
  local rc=$?
  if [ $rc -eq 0 ]; then echo OK
  elif grep -q "permission denied" "$T/ins.out"; then echo "permission denied"
  elif grep -q "row-level security" "$T/ins.out"; then echo "row-level security"
  else grep -m1 "ERROR" "$T/ins.out" | tr -d '\r'; fi
}
expect_ins() { # descr esperado base papel cols vals
  local r; r=$(ins "$3" "$4" "$5" "$6")
  case "$2" in
    OK) [ "$r" = "OK" ] && ok "$1" || bad "$1 (obtido: $r)";;
    DENY) [ "$r" = "permission denied" ] && ok "$1 (42501)" || bad "$1 (obtido: $r)";;
  esac
}

R22="${PFX}_ref22"; R23="${PFX}_ref23"; FX="${PFX}_fx"; X="${PFX}_x"
M31="$M/0031_suggestions_insert_columns.sql"; R31="$M/0031_suggestions_insert_columns.rollback.sql"
SUG='^(EXCESSO)\|(anon|authenticated) INSERT\* em suggestions'

echo "== bases"
newdb "$R22"; chain "$R22" 0022 || exit 1
newdb "$R23"; chain "$R23" 0023 || exit 1
newdb "$FX" "$R22"; pg "$FX" -f "$HERE/prod-acl-e2.fixture.local.sql" >/dev/null || exit 1; snap "$FX" sfx

echo "== T1 fixture (produção)"
preflight "$FX" fx
[ "$(grep -cE "$SUG" "$T/fx.pre")" = "2" ] && ok "pré-voo: 2 EXCESSO de suggestions" || bad "EXCESSO de suggestions: $(grep -cE "$SUG" "$T/fx.pre")"
expect_ins "antes: anon escolhe created_at (o excesso existe)" OK "$FX" anon ", created_at" ", now() - interval '400 days'"

echo "== T2 a 0031 recusa estados errados"
apply_abort "0031 aborta no estado do staging (0023 aplicada)" "$R23" "$M31" "0031 abortada (P2"
apply_abort "rollback 0031 aborta no estado do staging (sem marcador)" "$R23" "$R31" "rollback 0031 abortado (R1): marcador"
apply_abort "rollback 0031 aborta na fixture (sem marcador)" "$FX" "$R31" "rollback 0031 abortado (R1): marcador"
newdb "${X}g" "$FX"; pg "${X}g" -c "grant insert on public.suggestions to anon with grant option" >/dev/null
apply_abort "0031 aborta com opcao de concessao" "${X}g" "$M31" "com opcao de concessao"
newdb "${X}c" "$FX"; pg "${X}c" -c "comment on table public.suggestions is 'outro'" >/dev/null
apply_abort "0031 aborta se suggestions ja tiver comentario" "${X}c" "$M31" "ja tem comentario"
newdb "${X}p" "$FX"; pg "${X}p" -c "create policy extra on public.suggestions for insert to anon with check (true)" >/dev/null
apply_abort "0031 aborta com politica a mais" "${X}p" "$M31" "politica inesperada"
newdb "${X}k" "$FX"; pg "${X}k" -c "grant update (status) on public.suggestions to anon" >/dev/null
apply_abort "0031 aborta com privilegio de coluna previo" "${X}k" "$M31" "privilegio de coluna"

echo "== T3 0031 na fixture"
apply_ok "0031 aplica" "$FX" "$M31"; snap "$FX" sfx31
preflight "$FX" fx31
[ "$(grep -cE "$SUG" "$T/fx31.pre")" = "0" ] && ok "pré-voo sem EXCESSO de suggestions" || bad "EXCESSO de suggestions ainda presente"
if diff <(grep -vE "$SUG" "$T/fx.pre") "$T/fx31.pre" >/dev/null; then ok "o resto do pré-voo não muda (MATRIZ vazia, 0024 P2 igual)"
else bad "o pré-voo mudou além de suggestions"; diff <(grep -vE "$SUG" "$T/fx.pre") "$T/fx31.pre"; fi
same "catálogo igual ao da fixture fora de suggestions" sfx sfx31 'public\.suggestions|^comment\|pg_class\|table suggestions\|'

echo "== T4 clientes (app Android/iOS: insert das 6 colunas, return=minimal)"
for r in anon authenticated; do
  expect_ins "$r: insert da app passa" OK "$FX" $r "" ""
  expect_ins "$r: com created_at -> negado" DENY "$FX" $r ", created_at" ", now()"
  expect_ins "$r: com id -> negado" DENY "$FX" $r ", id" ", gen_random_uuid()"
  expect_ins "$r: com schedule -> negado" DENY "$FX" $r ", schedule" ", 'x'"
  expect_ins "$r: com status -> negado" DENY "$FX" $r ", status" ", 'pending'"
done
st=$("$PSQL" -U postgres -d "$FX" -X -At -q -c "begin; set local role anon; insert into public.suggestions (title, location, phone, comment, email, language) values ('S', 'L', '0', null, 'a@example.invalid', 'pt'); reset role; select status from public.suggestions where title = 'S'; rollback;" 2>&1 | tail -1)
[ "$st" = "pending" ] && ok "default status = pending" || bad "status obtido: $st"

echo "== T5 rollback, reaplicação"
apply_ok "rollback 0031 aplica" "$FX" "$R31"; snap "$FX" sfx_rb
same "rollback 0031 = fixture" sfx sfx_rb
apply_ok "0031 reaplica" "$FX" "$M31"
apply_abort "0031 não é idempotente (marcador)" "$FX" "$M31" "0031 abortada (P1)"

echo "== T6 composição com a W1 (0030 → 0024 → 0025 → 0026)"
for f in 0030_prod_interest_acl_baseline 0024_activity_interests_rpc 0025_delete_my_account 0026_legacy_interest_compat; do
  apply_ok "$f aplica depois da 0031" "$FX" "$M/$f.sql"
done
expect_ins "anon: insert da app continua a passar no estado 0026" OK "$FX" anon "" ""
preflight "$FX" fx26
[ "$(grep -c '^MATRIZ|' "$T/fx26.pre" || true)" = "0" ] && ok "MATRIZ vazia no estado final" || bad "MATRIZ com linhas no estado final"

echo "TOTAL $PASS PASS, $FAILS FAIL"
[ "$FAILS" = "0" ]
