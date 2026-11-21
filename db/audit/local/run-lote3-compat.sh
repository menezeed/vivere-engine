#!/usr/bin/env bash
# ============================================================
# Runner SÓ LOCAL da compatibilidade de rollout (Lote 3: 0026/0027).
# Cria bases descartáveis (prefixo obrigatório l3c_), aplica
# supabase-sim.sql + cadeia, e verifica:
#   T1 cadeia limpa 0000→0027; catálogo final IGUAL ao de 0000→0025;
#   T2 0026 muda exactamente 3 factos do catálogo (política, comentário,
#      UPDATE(interested_count) de anon);
#   T3 cliente antigo + RPC: lote3-compat-tests (legacy no estado 0026,
#      hardened nos estados 0024, 0025 e 0027);
#   T4 rollbacks exactos (0027 → estado 0026; 0026 → estado 0025) e
#      reaplicações que abortam; ciclo completo 0025/0024 rollback → reaplicar;
#   T5 pré-condições: cada adulteração aborta sem alterar nada;
#   T6 concorrência caminho legado x RPC (várias sessões psql);
#   T7 suites do Lote 2 (rpc, abuso, concorrência) no estado final 0027.
#
# Uso: PSQL=/caminho/psql PGHOST=127.0.0.1 PGPORT=54329 L3C_TMP=/dir \
#      run-lote3-compat.sh <prefixo l3c_*> <raiz do repo engine>
# NUNCA apontar a um Supabase (staging/produção).
# ============================================================
set -u
PFX="${1:?prefixo l3c_*}"; ENG="${2:?raiz do repo}"
case "$PFX" in l3c_*) ;; *) echo "Recusado: prefixo tem de ser l3c_*"; exit 2;; esac
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "Recusado: PGHOST tem de ser local"; exit 2;; esac
PSQL="${PSQL:-psql}"; T="${L3C_TMP:?L3C_TMP}"; mkdir -p "$T"
HERE="$(cd "$(dirname "$0")" && pwd)"
M="$ENG/db/migrations"; SNAP="$HERE/lote3-catalog-snapshot.local.sql"
M26="$M/0026_legacy_interest_compat.sql";      R26="$M/0026_legacy_interest_compat.rollback.sql"
M27="$M/0027_revoke_legacy_interest.sql";      R27="$M/0027_revoke_legacy_interest.rollback.sql"
su() { "$PSQL" -U supabase_admin -X -q -v ON_ERROR_STOP=1 "$@"; }
pg() { local db="$1"; shift; "$PSQL" -U postgres -d "$db" -X -q -v ON_ERROR_STOP=1 "$@"; }
PASS=0; FAILS=0
ok()  { echo "PASS | $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL | $1"; FAILS=$((FAILS+1)); }

newdb() { # base [template]
  su -d postgres -c "drop database if exists $1" >/dev/null 2>&1
  if [ -n "${2:-}" ]; then su -d postgres -c "create database $1 template $2" >/dev/null || exit 1
  else su -d postgres -c "create database $1" >/dev/null || exit 1
    grep -vE "^create role|^grant anon, authenticated, service_role to" "$HERE/supabase-sim.sql" > "$T/sim.sql"
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
same() { # descr snapA snapB
  if diff -q "$T/$2.snap" "$T/$3.snap" >/dev/null; then ok "$1 ($(wc -l < "$T/$2.snap") factos iguais)"
  else bad "$1"; diff "$T/$2.snap" "$T/$3.snap" | head -20; fi
}
apply_ok() { # descr base ficheiro
  if pg "$2" -f "$3" >"$T/apply.log" 2>&1; then ok "$1"; else bad "$1"; cat "$T/apply.log"; fi
}
apply_abort() { # descr base ficheiro padrão-da-mensagem
  snap "$2" before
  if pg "$2" -f "$3" >"$T/apply.log" 2>&1; then bad "$1 (aplicou e devia abortar)"
  elif grep -q -- "$4" "$T/apply.log"; then
    snap "$2" after
    if diff -q "$T/before.snap" "$T/after.snap" >/dev/null; then
      ok "$1 -> $(grep -o 'ERROR: .*' "$T/apply.log" | head -1 | cut -c8-200)"
    else bad "$1 (abortou mas o catálogo mudou)"; fi
  else bad "$1 (erro inesperado)"; cat "$T/apply.log"; fi
}
suite() { # descr base modo
  su -d "$2" -v mode="$3" -f "$HERE/lote3-compat-tests.local.sql" >"$T/suite.out" 2>&1
  local rc=$? line; line=$(grep -o 'LOTE3 COMPAT.*de [0-9]*' "$T/suite.out")
  if [ $rc -eq 0 ]; then ok "$1: $line"; else bad "$1: $line"; grep -E '\| FAIL \|' "$T/suite.out"; fi
  grep -E '^.*(A1|A1i|D1|D2|O10c) \|' "$T/suite.out" | sed -e 's/^psql:[^ ]* NOTICE:  /       /' -e 's/^NOTICE:  /       /'
}
DB25="${PFX}_ref25"; DB24="${PFX}_ref24"; DB26="${PFX}_ref26"; DBM="${PFX}_main"; DBX="${PFX}_x"

echo "== T1/T2 bases de referência"
newdb "$DB24"; chain "$DB24" 0024 || exit 1
newdb "$DB25"; chain "$DB25" 0025 || exit 1; snap "$DB25" s25
newdb "$DB26"; chain "$DB26" 0026 || exit 1; snap "$DB26" s26
newdb "$DBM";  if chain "$DBM" 0027; then ok "T1 cadeia limpa 0000→0027 em $DBM"; else bad "T1 cadeia 0000→0027"; exit 1; fi
snap "$DBM" s27
same "T1 catálogo 0000→0027 = 0000→0025" s25 s27
d=$(diff "$T/s25.snap" "$T/s26.snap" | grep -c '^[<>]')
exp="colacl|public.activities.interested_count|anon|UPDATE|grantor=postgres|grantable=false"
if [ "$d" = 3 ] && diff "$T/s25.snap" "$T/s26.snap" | grep -q "^> $exp" \
   && diff "$T/s25.snap" "$T/s26.snap" | grep -q "^> policy|public.activities|compat_interested_count_update|PERMISSIVE|UPDATE|{anon,authenticated}|true|true" \
   && diff "$T/s25.snap" "$T/s26.snap" | grep -q "^> comment|pg_policy|policy compat_interested_count_update on table activities|"
then ok "T2 0026 acrescenta exactamente 3 factos (política, comentário, anon UPDATE(interested_count)) e não retira nenhum"
else bad "T2 diferença 0025→0026 inesperada ($d linhas)"; diff "$T/s25.snap" "$T/s26.snap"; fi

echo "== T3 cliente antigo e RPC por estado"
suite "T3 estado 0024 (janela antes da 0026): cliente antigo falha em silêncio" "$DB24" hardened
suite "T3 estado 0025" "$DB25" hardened
suite "T3 estado 0026 (transição): cliente antigo E RPC funcionam" "$DB26" legacy
suite "T3 estado 0027" "$DBM" hardened

echo "== T4 rollbacks e reaplicação"
apply_abort "T4 reaplicar 0027 aborta" "$DBM" "$M27" "0027 abortada"
apply_abort "T4 rollback 0026 sobre o estado 0027 aborta" "$DBM" "$R26" "Rollback 0026 abortado"
apply_ok    "T4 rollback 0027 aplicado" "$DBM" "$R27"; snap "$DBM" m_rb27
same "T4 estado depois do rollback 0027 = estado 0026" s26 m_rb27
apply_abort "T4 repetir rollback 0027 aborta" "$DBM" "$R27" "Rollback 0027 abortado"
apply_abort "T4 reaplicar 0026 sobre o estado 0026 aborta" "$DBM" "$M26" "0026 abortada"
apply_abort "T4 rollback 0024 com a 0026 aplicada aborta" "$DBM" "$M/0024_activity_interests_rpc.rollback.sql" "Rollback 0024 abortado"
apply_ok    "T4 0027 aplicada de novo" "$DBM" "$M27"; snap "$DBM" m_27b
same "T4 estado 0027 (2ª vez) = 0025" s25 m_27b
newdb "$DBX" "$DB26"
apply_ok    "T4 rollback 0026 aplicado" "$DBX" "$R26"; snap "$DBX" x_rb26
same "T4 estado depois do rollback 0026 = estado 0025" s25 x_rb26
apply_abort "T4 repetir rollback 0026 aborta" "$DBX" "$R26" "Rollback 0026 abortado"
apply_ok    "T4 0026 reaplicada depois do rollback" "$DBX" "$M26"; snap "$DBX" x_26b
same "T4 estado 0026 (2ª vez) = estado 0026" s26 x_26b
# ciclo completo a partir do estado final: 0025 e 0024 para trás e tudo de novo
newdb "$DBX" "$DBM"
apply_ok "T4 ciclo: rollback 0025 (estado 0027)" "$DBX" "$M/0025_delete_my_account.rollback.sql"
apply_ok "T4 ciclo: rollback 0024" "$DBX" "$M/0024_activity_interests_rpc.rollback.sql"
for f in 0024_activity_interests_rpc 0025_delete_my_account 0026_legacy_interest_compat 0027_revoke_legacy_interest; do
  apply_ok "T4 ciclo: reaplicar $f" "$DBX" "$M/$f.sql"
done
snap "$DBX" x_cycle; same "T4 ciclo completo termina = 0025" s25 x_cycle

echo "== T5 pré-condições (cada adulteração aborta e não altera nada)"
t5() { # descr template sql-adulteração ficheiro padrão
  newdb "$DBX" "$2"; su -d "$DBX" -c "$3" >/dev/null || { bad "$1 (setup)"; return; }
  apply_abort "T5 $1" "$DBX" "$4" "$5"
}
t5 "0026 sem a 0025" "$DB24" "select 1" "$M26" "0026 abortada"
t5 "0026 com trigger guard desactivado" "$DB25" "alter table public.activities disable trigger guard_activities_update" "$M26" "trigger guard_activities_update"
t5 "0026 com corpo do guard alterado (delta 5)" "$DB25" \
   "update pg_proc set prosrc = replace(prosrc, 'delta not in (-1, 0, 1)', 'delta not in (-5, 0, 5)') where oid = 'public.guard_activities_update()'::regprocedure" \
   "$M26" "funcao guard_activities_update diferente"
t5 "0026 com anon UPDATE(title) preexistente" "$DB25" "grant update (title) on public.activities to anon" "$M26" "ACL de coluna em activities"
t5 "0026 com anon UPDATE de tabela preexistente" "$DB25" "grant update on public.activities to anon" "$M26" "UPDATE de tabela em activities para anon"
t5 "0026 com UPDATE para PUBLIC" "$DB25" "grant update (interested_count) on public.activities to public" "$M26" "ACL de coluna em activities: inesperada: PUBLIC"
t5 "0026 com política extra em activities" "$DB25" "create policy x_extra on public.activities for update to anon using (true)" "$M26" "inesperada: x_extra"
t5 "0026 sem UPDATE de authenticated" "$DB25" "revoke update on public.activities from authenticated" "$M26" "authenticated sem UPDATE"
t5 "0026 com deriva do endurecimento 0024 (anon INSERT em active_activities)" "$DB25" "grant insert on public.active_activities to anon" "$M26" "anon tem INSERT em active_activities"
t5 "0026 com EXECUTE de increment_activity_interest" "$DB25" "grant execute on function public.increment_activity_interest(uuid, smallint) to anon" "$M26" "tem EXECUTE em increment_activity_interest"
t5 "0026 com ACL de activity_interests" "$DB25" "grant select on public.activity_interests to authenticated" "$M26" "entrada de ACL em activity_interests"
t5 "0026 com RLS desligado" "$DB25" "alter table public.activities disable row level security" "$M26" "rls desligado"
t5 "0026 com RPC de outro dono" "$DB25" "alter function public.get_my_interests(uuid[]) owner to supabase_admin" "$M26" "dono/ACL/security definer"
t5 "0027 sem a 0026" "$DB25" "select 1" "$M27" "0027 abortada"
t5 "0027 com anon UPDATE(title) extra" "$DB26" "grant update (title) on public.activities to anon" "$M27" "inesperada: anon UPDATE(title)"
t5 "0027 com comentário de transição alterado" "$DB26" "comment on policy compat_interested_count_update on public.activities is 'x'" "$M27" "comentario de transicao"
t5 "0027 com política compat alterada" "$DB26" "alter policy compat_interested_count_update on public.activities to anon" "$M27" "compat_interested_count_update"
t5 "rollback 0026 com anon UPDATE(interested_count) também concedido por outro grantor" "$DB26" \
   "grant update (interested_count) on public.activities to service_role with grant option; set role service_role; grant update (interested_count) on public.activities to anon" \
   "$R26" "Rollback 0026 abortado"
t5 "rollback 0027 com política extra" "$DB25" "create policy x_extra on public.activities for update to anon using (true)" "$R27" "Rollback 0027 abortado"

echo "== T6 concorrência caminho legado x RPC (estado 0026)"
newdb "$DBX" "$DB26"
ACT=13ca0000-0000-4000-8000-0000000000c6
su -d "$DBX" >/dev/null <<SQL || exit 1
insert into auth.users(id, email) select ('13c00000-0000-4000-8000-0000000001' || g)::uuid, 'l3c_conc' || g || '@x.test' from generate_series(10, 13) g;
insert into public.activities(id, title, start_date, recurrence_type, interested_count) values ('$ACT', 'l3c conc', now() + interval '7 days', 'none', 0);
SQL
for g in 10 11 12 13; do
  : > "$T/rpc-$g.sql"
  for i in $(seq 1 201); do v=$([ $((i % 2)) -eq 1 ] && echo true || echo false)
    printf "begin; select set_config('request.jwt.claims','{\"role\":\"authenticated\",\"sub\":\"13c00000-0000-4000-8000-0000000001%s\"}',true); set local role authenticated; select * from public.set_activity_interest('%s', %s); commit;\n" "$g" "$ACT" "$v" >> "$T/rpc-$g.sql"
  done
done
for k in 1 2; do
  : > "$T/leg-$k.sql"
  for i in $(seq 1 150); do
    printf "select coalesce(interested_count,0) as v from public.activities where id = '%s' \\\\gset\nbegin; set local role anon; select set_config('request.jwt.claims','{\"role\":\"anon\"}',true); update public.activities set interested_count = :v + 1 where id = '%s'; commit;\n" "$ACT" "$ACT" >> "$T/leg-$k.sql"
  done
done
pids=()
for f in "$T"/rpc-1?.sql "$T"/leg-?.sql; do "$PSQL" -U supabase_admin -d "$DBX" -X -q -At -f "$f" > "$f.out" 2>&1 & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
rpc_err=$(cat "$T"/rpc-1?.sql.out | grep -c ERROR)
leg_err=$(cat "$T"/leg-?.sql.out | grep -c ERROR)
leg_guard=$(cat "$T"/leg-?.sql.out | grep -c "só pode variar\|nunca pode ficar negativo")
dead=$(cat "$T"/*.sql.out | grep -ci deadlock)
res=$(su -d "$DBX" -At -c "select interested_count || '|' || (select count(*) from public.activity_interests where activity_id = '$ACT') from public.activities where id = '$ACT'")
cnt=${res%|*}; rows=${res#*|}
[ "$rpc_err" = 0 ] && ok "T6 RPC: 0 erros em 4 sessões x 201 chamadas, em paralelo com 2 sessões legadas x 150" || bad "T6 RPC com $rpc_err erros"
[ "$dead" = 0 ] && ok "T6 sem deadlocks" || bad "T6 $dead deadlocks"
[ "$leg_err" = "$leg_guard" ] && ok "T6 legado: só recusas do guard ($leg_guard de 300 PATCH com cache desactualizada)" || bad "T6 legado: erros não-guard ($leg_err vs $leg_guard)"
[ "$rows" = 4 ] && ok "T6 linhas = 4 (estado final de cada utilizador RPC)" || bad "T6 linhas=$rows"
[ "$cnt" -ge 0 ] && [ $((cnt - rows)) -le 300 ] && [ $((rows - cnt)) -le 300 ] \
  && ok "T6 deriva contador-linhas = $((cnt - rows)) (contador $cnt, linhas $rows; limite teórico ±300 = nº de PATCH legados)" \
  || bad "T6 deriva fora do limite ($cnt/$rows)"

echo "== T7 suites do Lote 2 no estado final 0027 ($DBM)"
su -d "$DBM" -f "$HERE/lote2-rpc-tests.local.sql" >"$T/l2rpc.out" 2>&1 && ok "T7 $(grep -o 'LOTE2 RPC TESTES: .*' "$T/l2rpc.out" | tail -1)" \
  || { bad "T7 lote2-rpc-tests"; grep -E 'FAIL' "$T/l2rpc.out" | head; }
su -d "$DBM" -f "$HERE/lote2-abuse-tests.local.sql" >"$T/l2abuse.out" 2>&1 && ok "T7 $(grep -o 'LOTE2-ABUSE TOTAL: .*' "$T/l2abuse.out" | tail -1)" \
  || { bad "T7 lote2-abuse-tests"; grep -E '\| FAIL' "$T/l2abuse.out" | head; }
bash "$HERE/lote2-concurrency.local.sh" "$PSQL" "$DBM" >"$T/l2conc.out" 2>&1 && ok "T7 $(tail -1 "$T/l2conc.out")" \
  || { bad "T7 lote2-concurrency"; cat "$T/l2conc.out"; }
snap "$DBM" m_final; same "T7 catálogo depois das suites (só rollback/limpeza) = 0025" s25 m_final

su -d postgres -c "drop database if exists $DBX" >/dev/null 2>&1
echo "== RESUMO LOTE3: $PASS PASS, $FAILS FAIL"
[ $FAILS -eq 0 ]
