#!/usr/bin/env bash
# ============================================================
# Runner SÓ LOCAL dos testes de abuso do Lote 2.
# Cria uma base descartável (nome obrigatoriamente l2s_*), aplica
# supabase-sim.sql + 0000..0023 + 0024_activity_interests_rpc + 0025,
# corre lote2-abuse-tests.local.sql, os testes de concorrência (várias
# sessões psql em paralelo) e um ciclo rollback → reaplicação.
#
# Uso:  PSQL=/caminho/psql PGHOST=127.0.0.1 PGPORT=54329 L2S_TMP=/dir \
#       run-lote2-abuse.sh <base l2s_*> <raiz do repo engine> [plain|fdacl]
#   fdacl: antes das migrações, imita o default ACL de funções do Supabase
#          (EXECUTE para anon/authenticated/service_role) para provar que
#          os REVOKE são explícitos.
# NUNCA apontar a um Supabase (staging/produção).
# ============================================================
set -u
DB="${1:?base l2s_*}"; ENG="${2:?raiz do repo}"; VARIANT="${3:-plain}"
case "$DB" in l2s_*) ;; *) echo "Recusado: base tem de ser l2s_*"; exit 2;; esac
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "Recusado: PGHOST tem de ser local"; exit 2;; esac
PSQL="${PSQL:-psql}"; T="${L2S_TMP:?L2S_TMP}"; mkdir -p "$T"
HERE="$(cd "$(dirname "$0")" && pwd)"
su() { "$PSQL" -U supabase_admin -X -q -v ON_ERROR_STOP=1 "$@"; }
pg() { "$PSQL" -U postgres -d "$DB" -X -q -v ON_ERROR_STOP=1 "$@"; }
M="$ENG/db/migrations"
FAILS=0

echo "== base $DB ($VARIANT) a partir de $ENG"
su -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null || exit 1
grep -vE "^create role|^grant anon, authenticated, service_role to" "$ENG/db/audit/local/supabase-sim.sql" > "$T/sim-$DB.sql"
su -d "$DB" -v dbname="$DB" -f "$T/sim-$DB.sql" >/dev/null || exit 1
if [ "$VARIANT" = fdacl ]; then
  su -d "$DB" -c "alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role" || exit 1
fi
for f in $(ls "$M"/0*.sql | grep -v rollback | sort); do
  n=$(basename "$f" | cut -c1-4); [ "$n" \> "0023" ] && break
  pg -f "$f" >/dev/null || { echo "FALHOU migração $(basename "$f")"; exit 1; }
done
apply_l2() {
  for f in "$M/0024_activity_interests_rpc.sql" "$M"/0025_delete_my_account.sql; do
    [ -f "$f" ] || { echo "AUSENTE: $f"; FAILS=$((FAILS+1)); continue; }
    pg -f "$f" >"$T/$DB-$(basename "$f").log" 2>&1 || { echo "FALHOU $(basename "$f")"; cat "$T/$DB-$(basename "$f").log"; FAILS=$((FAILS+1)); }
  done
}
apply_l2

run_suite() {
  echo "== suite ($1)"
  su -d "$DB" -f "$HERE/lote2-abuse-tests.local.sql" > "$T/$DB-suite-$1.out" 2>&1
  local rc=$?
  sed -e 's/^psql:[^ ]* NOTICE:  //' -e 's/^NOTICE:  //' "$T/$DB-suite-$1.out" | grep -vE '^(CONTEXT|PL/pgSQL)'
  [ $rc -ne 0 ] && FAILS=$((FAILS+1))
}
run_suite pass1

# ---------- concorrência ----------
echo "== concorrência"
P=5ec00000-0000-4000-8000-0000000000c1; Q=5ec00000-0000-4000-8000-0000000000c2
R=5ec00000-0000-4000-8000-0000000000c3; S=5ec00000-0000-4000-8000-0000000000c4
C1=ac700000-0000-4000-8000-0000000000c1; C2=ac700000-0000-4000-8000-0000000000c2; C3=ac700000-0000-4000-8000-0000000000c3
su -d "$DB" >/dev/null <<SQL || exit 1
insert into auth.users(id, email) values ('$P','p@x.test'),('$Q','q@x.test'),('$R','r@x.test'),('$S','s@x.test');
insert into public.activities(id, title, start_date, recurrence_type, interested_count) values
  ('$C1','cc1', now() + interval '7 days','none',0),('$C2','cc2', now() + interval '7 days','none',0),
  ('$C3','cc3', now() + interval '7 days','none',0);
SQL
# gen <ficheiro> <user> <act> <n> <modo: alt1|alt0|true>
gen() {
  : > "$1"
  for i in $(seq 1 "$4"); do
    case "$5" in alt1) v=$([ $((i % 2)) -eq 1 ] && echo true || echo false);;
                 alt0) v=$([ $((i % 2)) -eq 0 ] && echo true || echo false);; *) v=true;; esac
    printf "begin; select set_config('request.jwt.claims','{\"role\":\"authenticated\",\"sub\":\"%s\"}',true); set local role authenticated; select * from public.set_activity_interest('%s', %s); commit;\n" "$2" "$3" "$v" >> "$1"
  done
}
runpar() { # ficheiros...
  local pids=() k=0
  for f in "$@"; do "$PSQL" -U supabase_admin -d "$DB" -X -q -At -f "$f" > "$f.out" 2>&1 & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p"; done
  for f in "$@"; do k=$((k + $(grep -c 'ERROR' "$f.out"))); done
  echo "$k"
}
check() { # descr sql esperado
  local got; got=$(su -d "$DB" -At -c "$2")
  if [ "$got" = "$3" ]; then echo "PASS | $1 | $got"; else echo "FAIL | $1 | obtido=$got esperado=$3"; FAILS=$((FAILS+1)); fi
}
# H1: 4 utilizadores diferentes, 201 alternâncias cada (terminam em true), mesma actividade
for u in $P $Q $R $S; do gen "$T/h1-$u.sql" "$u" "$C1" 201 alt1; done
e=$(runpar "$T"/h1-*.sql); check "H1 erros em 4 sessões paralelas (utilizadores distintos)" "select $e" 0
check "H1 contador = 4 = linhas" "select interested_count || '/' || (select count(*) from public.activity_interests where activity_id='$C1') from public.activities where id='$C1'" "4/4"
# H2: mesmo utilizador, 2 sessões a marcar true 200x
gen "$T/h2-a.sql" "$P" "$C2" 200 true; gen "$T/h2-b.sql" "$P" "$C2" 200 true
e=$(runpar "$T/h2-a.sql" "$T/h2-b.sql"); check "H2 sem erros (nenhum 23505 a escapar)" "select $e" 0
check "H2 contador = 1 = linhas" "select interested_count || '/' || (select count(*) from public.activity_interests where activity_id='$C2') from public.activities where id='$C2'" "1/1"
# H3: mesmo utilizador, 2 sessões em fase oposta (true/false), 300x cada
gen "$T/h3-a.sql" "$Q" "$C3" 300 alt1; gen "$T/h3-b.sql" "$Q" "$C3" 300 alt0
e=$(runpar "$T/h3-a.sql" "$T/h3-b.sql"); check "H3 sem erros" "select $e" 0
check "H3 contador = nº de linhas (0 ou 1), nunca negativo" "select (interested_count = (select count(*) from public.activity_interests where activity_id='$C3') and interested_count between 0 and 1)::text from public.activities where id='$C3'" "true"
check "H* unicidade (activity_id,user_id) mantida" "select count(*) from (select 1 from public.activity_interests where user_id is not null group by activity_id, user_id having count(*) > 1) d" 0

# ---------- rollback e reaplicação ----------
echo "== rollback → reaplicação"
for f in "$M/0025_delete_my_account.rollback.sql" "$M/0024_activity_interests_rpc.rollback.sql"; do
  [ -f "$f" ] || { echo "FAIL | rollback ausente: $(basename "$f")"; FAILS=$((FAILS+1)); continue; }
  pg -f "$f" >"$T/$DB-$(basename "$f").log" 2>&1 && echo "PASS | aplicado $(basename "$f")" || { echo "FAIL | $(basename "$f")"; cat "$T/$DB-$(basename "$f").log"; FAILS=$((FAILS+1)); }
done
check "após rollback: as 3 RPC não existem" "select count(*) from unnest(array['public.set_activity_interest(uuid,boolean)','public.get_my_interests(uuid[])','public.delete_my_account()']) s where to_regprocedure(s) is not null" 0
apply_l2
run_suite pass2

echo "== RUNNER FAILS=$FAILS"
[ $FAILS -eq 0 ]
