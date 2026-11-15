# Runbook — Rollout em PRODUÇÃO das migrações 0023–0027 (interesses e conta)

Estado: PROPOSTA (Lote 3), não executado. Validado só na simulação local
(`db/audit/local/run-lote3-compat.sh`). Cada passo em produção precisa de REF
Level 2 próprio. Projecto de produção: ref `ccpqngyupukdefaqvzgl`. Parar ao
primeiro erro e não reparar a meio.

## 1. Regra de ordem (bloqueante)

**Nenhuma versão nova da app (que usa `set_activity_interest`,
`get_my_interests` ou `delete_my_account`) é publicada em produção antes de
0023 → 0024 → 0025 → 0026 estarem aplicadas em produção.** Sem elas a versão
nova recebe `PGRST202` (função inexistente) ao marcar interesse e ao apagar a
conta.

Dentro da janela a ordem é estritamente numérica: a 0026 tem de vir **depois**
da 0025 (a P1 da 0025 aborta se a política `compat_interested_count_update`
existir). A 0027 fica para uma janela posterior (secção 5).

## 2. Porque há uma migração transitória

As versões instaladas (mobile `main` c390c92 e anteriores) marcam interesse com
`PATCH /rest/v1/activities?id=eq.X {interested_count: cache±1}` (como `anon`
sem sessão, `authenticated` com sessão) e ignoram erros. A 0024 fecha esse
caminho. A app antiga **não tem mecanismo de actualização forçada** (não há
verificação de versão mínima no código de c390c92): esta coorte só desaparece
à medida que os utilizadores actualizam pelas lojas. A 0026 mantém o
contador a funcionar para eles enquanto a nova versão é adoptada; a 0027
fecha-o.

Sem a 0026 a app antiga **não rebenta**: o coração muda localmente, o
contador no servidor não mexe (testado: estado 0024/0025/0027, 42/42).

## 3. Antes da janela (só leitura, Level 2)

1. Auditoria de produção só de leitura (`db/audit/grants-audit.readonly.sql`)
   guardada em CSV. É ela que diz se as P1/P2 da 0023/0024 vão passar: a
   produção pode ter ACL diferente do staging; **não assumir**.
2. Confirmar os pressupostos da 0025 (runbook de staging, secção 3d passo 5).
3. Confirmar o pressuposto da 0026 sobre o trigger guard (a 0026 aborta se o
   corpo da função for diferente do da 0020, e nessa altura a 0024 já estaria
   aplicada):

```sql
select (select tgenabled = 'O' and tgtype = 19 from pg_catalog.pg_trigger
        where tgrelid = 'public.activities'::regclass and tgname = 'guard_activities_update') as trigger_ok,
       (select prosecdef and md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) = '0907e30220725862edb3497a9b42bb98'
        from pg_catalog.pg_proc where oid = to_regprocedure('public.guard_activities_update()')) as guard_ok;
-- esperado: true | true. Se não, PARAR: a 0026 abortaria.
```

4. Ensaio completo no staging (0024 → 0025 → 0026 e, mais tarde, 0027) com a
   auditoria v2 e `db/audit/mobile-access-tests.staging.sql`.
5. Decidir com antecedência (Level 2) o plano de contingência da secção 4.

## 4. Janela W1 — 0023 → 0024 → 0025 → 0026 (uma sessão, seguidas)

Mesmo operador, papel `postgres`, SQL Editor, um Run por ficheiro, sem pausa
entre a 0024 e a 0026 (entre os dois commits a app antiga não mexe no
contador; nada rebenta).

| Passo | Ficheiro | Se abortar |
|---|---|---|
| 1 | `0023_mobile_app_table_grants.sql` | PARAR. Nada mudou. |
| 2 | `0024_activity_interests_rpc.sql` | PARAR. Nada mudou (0023 fica; é segura sozinha). |
| 3 | `0025_delete_my_account.sql` | Correr `0024_…rollback.sql` (repõe o caminho legado da 0020) e PARAR. |
| 4 | `0026_legacy_interest_compat.sql` | Decisão prévia: (a) `0025_…rollback.sql` + `0024_…rollback.sql` (volta ao estado anterior) ou (b) aceitar a app antiga com contador congelado até à 0027. |

Depois do passo 4, auditoria v2. **Esperado no estado 0026** (simulação):
exactamente 2 desvios conhecidos e transitórios — `I proibido
public.activities anon UPDATE real=C ATENCAO` e `K cadeia 0024 policy
compat_interested_count_update removida FALTA`. Qualquer outro `ATENCAO`/`FALTA`
→ PARAR e reportar.

Rollback de emergência, por ordem inversa: `0026_…rollback.sql` (fecha o
caminho legado; estado = 0025), depois `0025_…rollback.sql`, depois
`0024_…rollback.sql`. O rollback da 0024 aborta enquanto a 0026 estiver
aplicada.

## 5. Janela W2 — publicar a versão nova; observar

Só depois da W1. A versão nova deve incluir verificação de versão mínima
(para futuras transições). Observar o tráfego legado: qualquer `PATCH` em
`/rest/v1/activities` por `anon` ou `authenticated` sem `app_metadata.role =
admin` vem **só** da app antiga (a nova nunca faz PATCH em `activities`; o
painel admin usa JWT admin). Fonte: logs da API do Supabase (só leitura).

**Critérios de adopção para a 0027** (propostos; limiares a fixar pelo
Level 2):

1. versão nova publicada nas duas lojas há ≥ 30 dias e ≥ 95 % das instalações
   activas (consolas das lojas) numa versão com RPC;
2. PATCH legado em `/rest/v1/activities` < 1 % das operações de interesse
   (ou < 5/dia) durante 14 dias seguidos;
3. sem abuso observado do contador (picos de PATCH do mesmo IP/actividade);
   se houver, aplicar a 0027 (ou o rollback da 0026) **antes** dos critérios;
4. 0027 ensaiada no staging; REF Level 2 próprio.

## 6. Janela W3 — 0027

`0027_revoke_legacy_interest.sql` (um Run). Aborta se o estado não for
exactamente o da 0026. Depois, auditoria v2 sem nenhum `ATENCAO`/`FALTA`
(igual ao estado 0025). Rollback, só com REF: `0027_…rollback.sql` (reabre o
caminho legado). Reconciliação do contador (`interested_count` = nº de linhas)
é uma decisão de dados separada (Level 2); estas migrações não tocam em dados.

## 7. Riscos da transição (estado 0026), medidos na simulação

- **Abuso**: 1 pedido anon = ±1, sem limite por utilizador, em qualquer
  actividade activa ou não (500 pedidos → +500, 0 linhas; −1 repetido leva a 0,
  nunca negativo). O limite real é o rate limit da API. É a mesma exposição que
  a produção já tem antes da 0024 (a P2 da 0024 garante que o ponto de partida
  é o da 0020).
- **Deriva do contador** (o contador já é "não auditado" desde a 0024): marca
  legada = +1 sem linha; a mesma pessoa na versão antiga e depois na nova = +2
  com 1 linha; desmarcar na nova não retira o +1 legado (deriva residual +1);
  cache desactualizada: escrever `cache+1` com 2 de atraso é aceite como −1,
  com 1 de atraso é 0 (perdido), com ≥ 3 é recusado pelo guard. Concorrência
  (4 sessões RPC × 201 + 2 sessões legadas × 150, 2 corridas): 0 erros RPC,
  0 deadlocks, 57–63 PATCH recusados pelo guard, deriva final +130 a +177
  (|deriva| ≤ nº de PATCH legados aceites; com 2+ RPC entre a leitura e o
  PATCH, o PATCH pode apagar um +1 da RPC). A RPC continua idempotente por utilizador.
- **Sem agravamento** de privilégios: só `UPDATE(interested_count)` de coluna
  para anon (o UPDATE de tabela da 0000 não volta) e a política da 0020;
  `activity_interests`, `active_activities` e `increment_activity_interest`
  ficam fechados.

## 8. Alternativa: não aplicar nada à produção até à actualização forçada

Manter a produção como está (sem 0023–0027) até a versão nova com versão
mínima forçada existir e ser adoptada. Contras: a versão nova não pode ser
publicada enquanto isso (regra da secção 1), e a coorte c390c92 não tem
actualização forçada — o "até" depende só de actualizações voluntárias; a
exposição que a 0024 fecharia (segundo a 0020: UPDATE de anon em
`activities`, escrita em `active_activities`, EXECUTE de
`increment_activity_interest`; o ACL real da produção só a auditoria dirá)
continua durante todo esse tempo.
Variante: aplicar 0023→0025 **sem** a 0026 (endurece já; a app antiga fica
com o contador congelado, sem erro). A estratégia (a) com 0026 é a decisão
Level 2.
