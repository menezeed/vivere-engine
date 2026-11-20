#!/usr/bin/env bash
# ============================================================
# Runner SÓ LOCAL da 0030 (ACL da produção → ponto de partida da 0024).
# Cria bases descartáveis (prefixo obrigatório p30_) num PostgreSQL local:
#   T1 fidelidade: o pré-voo sobre a fixture da produção devolve EXACTAMENTE
#      as 20 linhas 0024 P2 e as 4 EXCESSO da E2; 0023 P2 = 11; bloqueantes 0
#   T2 na fixture, 0023 e 0024 abortam sem alterar o catálogo
#   T3 a 0030 aborta no estado do staging (0000→0022) e o rollback da 0030
#      aborta na fixture; nada muda
#   T4 0030 na fixture: o pré-voo fica sem etapas bloqueantes
#   T5 rollback da 0030 → catálogo IGUAL ao da fixture; reaplicar OK
#   T6 0030 → 0024 → 0025 → 0026: catálogo IGUAL ao da cadeia do staging
#      (0000→0026) fora das 5 tabelas da 0023; a 0030 aborta depois da 0024
#   T7 rollback 0026 → 0025 → 0024 → 0030: catálogo IGUAL ao da fixture
# Uso: PSQL=/caminho/psql PGHOST=127.0.0.1 PGPORT=54329 P30_TMP=/dir \
#      run-0030-prod-acl.sh <prefixo p30_*> <raiz do repo engine>
# NUNCA apontar a um Supabase (staging/produção).
# ============================================================
set -u
PFX="${1:?prefixo p30_*}"; ENG="${2:?raiz do repo}"
case "$PFX" in p30_*) ;; *) echo "Recusado: prefixo tem de ser p30_*"; exit 2;; esac
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "Recusado: PGHOST tem de ser local"; exit 2;; esac
PSQL="${PSQL:-psql}"; T="${P30_TMP:?P30_TMP}"; mkdir -p "$T"
HERE="$(cd "$(dirname "$0")" && pwd)"
M="$ENG/db/migrations"; SNAP="$HERE/lote3-catalog-snapshot.local.sql"; PRE="$ENG/db/audit/prevoo-0023-0024.readonly.sql"
su() { "$PSQL" -U supabase_admin -X -q -v ON_ERROR_STOP=1 "$@"; }
pg() { local db="$1"; shift; "$PSQL" -U postgres -d "$db" -X -q -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAILS=0
ok()  { echo "PASS | $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL | $1"; FAILS=$((FAILS+1)); }

ROLES_DONE=0
newdb() { # base [template]
  su -d postgres -c "drop database if exists $1" >/dev/null 2>&1
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
same() { # descr snapA snapB [filtro-regex-a-ignorar]
  if [ -n "${4:-}" ]; then grep -vE "$4" "$T/$2.snap" > "$T/$2.f"; grep -vE "$4" "$T/$3.snap" > "$T/$3.f"; a="$T/$2.f"; b="$T/$3.f"
  else a="$T/$2.snap"; b="$T/$3.snap"; fi
  if diff -q "$a" "$b" >/dev/null; then ok "$1 ($(wc -l < "$a") factos iguais)"
  else bad "$1"; diff "$a" "$b" | head -20; fi
}
apply_ok() { if pg "$2" -f "$3" >"$T/apply.log" 2>&1; then ok "$1"; else bad "$1"; cat "$T/apply.log"; fi; }
apply_abort() { # descr base ficheiro padrão
  snap "$2" before
  if pg "$2" -f "$3" >"$T/apply.log" 2>&1; then bad "$1 (aplicou e devia abortar)"
  elif grep -q -- "$4" "$T/apply.log"; then
    snap "$2" after
    if diff -q "$T/before.snap" "$T/after.snap" >/dev/null; then ok "$1 -> $(grep -o 'ERROR: .*' "$T/apply.log" | head -1 | cut -c8-160)"
    else bad "$1 (abortou mas o catálogo mudou)"; fi
  else bad "$1 (erro inesperado)"; cat "$T/apply.log"; fi
}
preflight() { su -d "$1" -At -F '|' -f "$PRE" | cut -d'|' -f2- | sort > "$T/$2.pre"; }
count() { grep -c "^$2|" "$T/$1.pre" || true; }
BLOCK='^(0023 P1a|0023 P1b|MATRIZ|0024 P1a|0024 P1b|0024 P2|0024 VF)\|'

R22="${PFX}_ref22"; R26="${PFX}_ref26"; FX="${PFX}_fx"; X="${PFX}_x"
M23="$M/0023_mobile_app_table_grants.sql"; M24="$M/0024_activity_interests_rpc.sql"
M25="$M/0025_delete_my_account.sql";        M26="$M/0026_legacy_interest_compat.sql"
M30="$M/0030_prod_interest_acl_baseline.sql"; R30="$M/0030_prod_interest_acl_baseline.rollback.sql"
R24="$M/0024_activity_interests_rpc.rollback.sql"; R25="$M/0025_delete_my_account.rollback.sql"
R26F="$M/0026_legacy_interest_compat.rollback.sql"
FIVE='public\.(categories|venues|partners|favorites|suggestions)\b'

echo "== bases"
newdb "$R22"; chain "$R22" 0022 || exit 1
newdb "$R26"; chain "$R26" 0026 || exit 1; snap "$R26" s26
newdb "$FX" "$R22"; pg "$FX" -f "$HERE/prod-acl-e2.fixture.local.sql" >/dev/null || exit 1; snap "$FX" sfx

echo "== T1 fidelidade da fixture"
preflight "$FX" fx
grep -E '^(0024 P2|EXCESSO)\|' "$T/fx.pre" > "$T/fx.cmp"
if diff -q "$T/fx.cmp" "$HERE/prod-acl-e2.expected.txt" >/dev/null; then ok "pré-voo = 20 linhas 0024 P2 + 4 EXCESSO da produção"
else bad "pré-voo difere da produção"; diff "$T/fx.cmp" "$HERE/prod-acl-e2.expected.txt"; fi
[ "$(count fx '0023 P2')" = "11" ] && ok "0023 P2 = 11" || bad "0023 P2 = $(count fx '0023 P2')"
n=$(grep -E "$BLOCK" "$T/fx.pre" | grep -vc '^0024 P2|' || true)
[ "$n" = "0" ] && ok "restantes etapas bloqueantes = 0" || { bad "bloqueantes extra: $n"; grep -E "$BLOCK" "$T/fx.pre" | grep -v '^0024 P2|'; }

echo "== T2 na fixture, 0023 e 0024 abortam"
apply_abort "0023 aborta (P2)" "$FX" "$M23" "0023 abortada (P2"
apply_abort "0024 aborta (P2)" "$FX" "$M24" "0024 abortada (P2"

echo "== T3 a 0030 recusa estados errados"
apply_abort "0030 aborta no estado do staging (0000→0022)" "$R22" "$M30" "0030 abortada (P2"
apply_abort "rollback 0030 aborta na fixture" "$FX" "$R30" "rollback 0030 abortado (R2"

echo "== T4 0030 na fixture"
apply_ok "0030 aplica" "$FX" "$M30"
preflight "$FX" fx30
n=$(grep -cE "$BLOCK" "$T/fx30.pre" || true)
[ "$n" = "0" ] && ok "pré-voo sem etapas bloqueantes depois da 0030" || { bad "bloqueantes: $n"; grep -E "$BLOCK" "$T/fx30.pre"; }

echo "== T5 rollback da 0030 e reaplicação"
apply_ok "rollback 0030 aplica" "$FX" "$R30"; snap "$FX" sfx_rb
same "rollback 0030 = fixture" sfx sfx_rb
apply_ok "0030 reaplica" "$FX" "$M30"
apply_abort "0030 não é idempotente" "$FX" "$M30" "0030 abortada (P2"

echo "== T6 0024 → 0025 → 0026 sobre a 0030"
apply_ok "0024 aplica" "$FX" "$M24"
apply_abort "0030 aborta depois da 0024" "$FX" "$M30" "0030 abortada (P1"
apply_abort "rollback 0030 aborta com a 0024 aplicada" "$FX" "$R30" "rollback 0030 abortado (R1"
apply_ok "0025 aplica" "$FX" "$M25"
apply_ok "0026 aplica" "$FX" "$M26"; snap "$FX" sfx26
same "estado final = cadeia do staging 0000→0026 (fora das 5 tabelas da 0023)" s26 sfx26 "$FIVE"

echo "== T7 rollback de emergência 0026 → 0025 → 0024 → 0030"
apply_ok "rollback 0026" "$FX" "$R26F"
apply_ok "rollback 0025" "$FX" "$R25"
apply_ok "rollback 0024" "$FX" "$R24"
apply_ok "rollback 0030" "$FX" "$R30"; snap "$FX" sfx_back
same "depois dos rollbacks = fixture (produção)" sfx sfx_back

echo "TOTAL $PASS PASS, $FAILS FAIL"
[ "$FAILS" = "0" ]
