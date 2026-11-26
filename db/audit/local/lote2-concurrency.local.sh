#!/usr/bin/env bash
# ============================================================
# Teste SÓ LOCAL de concorrência de public.set_activity_interest (0024).
# REF: Lote 2, contrato v1.1. Recusa correr fora da simulação local
# (vivere.sim = 'local') e fora de 127.0.0.1.
#
# Uso: PGHOST=127.0.0.1 PGPORT=<porta> lote2-concurrency.local.sh <psql> <base>
#   Fixtures criadas com o superutilizador local (supabase_admin) e
#   apagadas no fim; as sessões concorrentes ligam como `postgres` e fazem
#   SET ROLE authenticated + request.jwt.claims (como o PostgREST).
#
# C1 Serialização: a sessão 1 chama a RPC (utilizador A) e mantém a
#    transacção aberta 3 s; a sessão 2 (utilizador B, mesma actividade)
#    tem de ficar à espera do lock da linha (FOR UPDATE) e o contador
#    final tem de ser exactamente +2.
# C2 Rajada: 20 processos psql em paralelo, 20 utilizadores diferentes,
#    mesma actividade -> contador exactamente +20 e 20 linhas.
# C3 Mesmo utilizador em 10 processos paralelos -> exactamente +1.
# ============================================================
set -u
PSQL="${1:?psql}"; DB="${2:?base}"
[ "${PGHOST:-}" = "127.0.0.1" ] || { echo "Recusado: só PGHOST=127.0.0.1"; exit 2; }
SU() { "$PSQL" -U supabase_admin -d "$DB" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
PG() { "$PSQL" -U postgres -d "$DB" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
[ "$(SU -c "select coalesce(current_setting('vivere.sim', true), '')")" = "local" ] || { echo "Recusado: base sem vivere.sim=local"; exit 2; }

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (esperado: $2 | obtido: $3)"; fail=$((fail+1)); fi; }
uid() { printf '00000000-0000-4000-8000-%012d' "$1"; }
call() { # $1 = n do utilizador, $2 = sleep depois da chamada (s), $3 = interested
  PG -c "begin" \
     -c "set local role authenticated" \
     -c "select set_config('request.jwt.claims', json_build_object('role','authenticated','sub','$(uid "$1")')::text, true)" \
     -c "select interested_count from public.set_activity_interest('$ACT', ${3:-true})" \
     -c "select pg_sleep(${2:-0})" -c "commit" >/dev/null
}

SU -c "insert into auth.users(id, email) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'conc' || g || '@example.invalid' from generate_series(9001, 9031) g"
ACT=$(SU -c "insert into public.activities(title, start_date, recurrence_type, interested_count) values ('Lote2 concorrencia', now() + interval '7 days', 'none', 0) returning id")
cleanup() {
  SU -c "delete from public.activity_interests where activity_id = '$ACT'" -c "delete from public.activities where id = '$ACT'" \
     -c "delete from auth.users where email like 'conc%@example.invalid'" >/dev/null
}
trap cleanup EXIT

# ---------- C1 ----------
call 9001 3 & p1=$!
sleep 1
t0=$(date +%s.%N)
call 9002 0 & p2=$!
sleep 1
waits=$(SU -c "select count(*) from pg_stat_activity where datname = '$DB' and wait_event_type = 'Lock' and query like '%set_activity_interest%'")
wait $p1; wait $p2; t1=$(date +%s.%N)
check "C1 sessão 2 esperou pelo lock da sessão 1 (pg_stat_activity)" 1 "$waits"
check "C1 sessão 2 só terminou depois do commit da sessão 1 (>= 1.5 s)" 1 "$(awk -v a="$t0" -v b="$t1" 'BEGIN{print (b-a >= 1.5) ? 1 : 0}')"
check "C1 contador +2 exactamente" "2|2" "$(SU -c "select interested_count || '|' || (select count(*) from public.activity_interests where activity_id = '$ACT') from public.activities where id = '$ACT'")"

# ---------- C2 ----------
pids=""
for n in $(seq 9011 9030); do call "$n" 0 & pids="$pids $!"; done
for p in $pids; do wait "$p"; done
check "C2 20 utilizadores em paralelo: contador +20 exactamente" "22|22" "$(SU -c "select interested_count || '|' || (select count(*) from public.activity_interests where activity_id = '$ACT') from public.activities where id = '$ACT'")"

# ---------- C3 ----------
pids=""
for n in $(seq 1 10); do call 9031 0 & pids="$pids $!"; done
for p in $pids; do wait "$p"; done
check "C3 mesmo utilizador 10x em paralelo: +1 exactamente" "23|23" "$(SU -c "select interested_count || '|' || (select count(*) from public.activity_interests where activity_id = '$ACT') from public.activities where id = '$ACT'")"
pids=""
for n in $(seq 1 10); do call 9031 0 false & pids="$pids $!"; done
for p in $pids; do wait "$p"; done
check "C3 mesmo utilizador desmarca 10x em paralelo: -1 exactamente" "22|22" "$(SU -c "select interested_count || '|' || (select count(*) from public.activity_interests where activity_id = '$ACT') from public.activities where id = '$ACT'")"

echo "LOTE2 CONCORRENCIA: $pass PASS, $fail FAIL de $((pass+fail))"
[ "$fail" -eq 0 ]
