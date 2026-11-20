# Runbook — Rollout em PRODUÇÃO das migrações 0023–0029 (interesses, conta, orçamento e vista)

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

## 9. Migrações 0028 e 0029 (não cobertas pelas secções 1–8)

O #19 leva para `main` também a 0028 e a 0029. Nenhuma delas toca nas
tabelas de interesses/conta, por isso **não entram na regra de ordem da
secção 1**. Cada uma precisa de REF Level 2 próprio em produção e, antes de
cada execução, do SHA-256 (LF) do ficheiro confirmado contra `APPLIED.sha256`.

### 9a. 0029 — `active_activities` pela data local (necessária para o go-live)

- **Porquê:** sem ela, entre as 21:00 e as 24:00 locais a vista esconde do
  app os eventos pontuais do próprio dia e as actividades que acabam nesse dia.
- **Staging:** aplicada a 16/11/2026 (`APPLIED.sha256`; simulação 16 OK /
  0 FALHA; validação pós sem divergências). Procedimento seguido:
  `reviews/PROCEDIMENTO-0029-STAGING.md`.
- **Interacção com a 0024:** `set_activity_interest` (0024) só deixa
  **marcar** interesse em actividades presentes em `active_activities`.
  Enquanto a 0029 não estiver aplicada, das 21:00 às 24:00 locais a RPC
  responde `activity_not_found` para os eventos desse dia. Não há ordem
  obrigatória entre a 0029 e a 0024/0026/0027 (estas verificam os
  privilégios da vista, não o filtro; `CREATE OR REPLACE VIEW` preserva
  ACL, dono e `security_invoker`). **Recomendação:** na W1, logo a seguir
  ao passo 4 e **antes** dos testes de aceitação da W1, para que a
  aceitação já veja o estado final.
- **Antes (só leitura; guardar o resultado):** tudo tem de dar o esperado,
  senão **PARAR** e pedir decisão (a vista de produção foi criada à mão
  antes do engine; não adaptar a migração na janela):

```sql
select current_setting('TimeZone') as timezone,                       -- UTC
  md5(btrim(regexp_replace(pg_get_viewdef('public.active_activities'::regclass), '[[:space:]]+', ' ', 'g')))
    = '03a323f8e96130744f5cd15bba786980' as definicao_baseline,      -- true (md5 do texto da P1)
  coalesce('security_invoker=true' = any(c.reloptions), false) as security_invoker, -- true
  obj_description(c.oid, 'pg_class') is null as sem_comentario,        -- true
  (exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
            where r.ev_class = c.oid and d.classid = 'pg_rewrite'::regclass
              and d.refclassid = 'pg_class'::regclass and d.refobjid = 'public.activities'::regclass)
   and not exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
            where r.ev_class = c.oid and d.classid = 'pg_rewrite'::regclass
              and d.refclassid = 'pg_class'::regclass
              and d.refobjid not in ('public.activities'::regclass, c.oid))) as origem_exclusiva, -- true
  c.relowner::regrole::text as dono, c.relacl::text as acl, c.reloptions::text as opcoes      -- guardar
from pg_class c where c.oid = 'public.active_activities'::regclass;
```

  (Ensaiada no staging a 20/11, só leitura: a consulta corre; como lá a 0029
  já está aplicada, dá `definicao_baseline = false` e `sem_comentario = false`,
  que é o estado pós-0029.)
- **Executar:** só o ficheiro da migração, com o SHA-256 confirmado. A
  simulação `db/audit/active-activities-local-date-tests.staging.sql` é só
  para staging (cria fixtures) e **não** corre em produção.
- **Depois (só leitura):**
  1. Definição, colunas e catálogo (revisão r1 do #40: não basta o
     booleano do baseline):

```sql
select md5(btrim(regexp_replace(pg_get_viewdef('public.active_activities'::regclass), '[[:space:]]+', ' ', 'g')))
         = '38935be4375550a66fef1af44dba18dc' as definicao_0029,   -- true
       btrim(regexp_replace(pg_get_viewdef('public.active_activities'::regclass), '[[:space:]]+', ' ', 'g')) as definicao, -- ler: só CURRENT_DATE trocado
       (select count(*) from pg_attribute a where a.attrelid = 'public.active_activities'::regclass
          and a.attnum > 0 and not a.attisdropped) as colunas,       -- 19
       c.relowner::regrole::text as dono, c.relacl::text as acl, c.reloptions::text as opcoes -- iguais aos guardados
from pg_class c where c.oid = 'public.active_activities'::regclass;
```

     O md5 é o da definição instalada no staging pela 0029 (lida a 20/11,
     só leitura): o baseline com `CURRENT_DATE` trocado por
     `((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo'::text))::date`
     nos dois sítios e nada mais. As duas consultas de md5 pressupõem o
     `search_path` por omissão (`"$user", public`, o mesmo do staging):
     `pg_get_viewdef` omite o schema das relações visíveis no caminho. A P1
     da migração continua a ser a verificação final.
  2. Os dois filtros comparados **na mesma instrução** (mesmo snapshot,
     mesmo instante, mesmo papel), o que elimina o falso alarme de
     escritas concorrentes ou de mudança de data entre consultas:

```sql
select count(*) filter (where f.antigo) as antigo,
       count(*) filter (where f.novo) as novo,
       count(*) filter (where f.antigo and not f.novo) as perdidas,   -- esperado 0
       (select count(*) from public.active_activities) as vista       -- esperado = novo
from public.activities a,
lateral (select
  ((a.end_date is null or a.end_date >= current_date)
   and (a.recurrence_type is not null and a.recurrence_type <> 'none'
        or a.recurrence_type = 'none' and a.start_date >= current_date)) as antigo,
  ((a.end_date is null or a.end_date >= (current_timestamp at time zone 'America/Sao_Paulo')::date)
   and (a.recurrence_type is not null and a.recurrence_type <> 'none'
        or a.recurrence_type = 'none' and a.start_date >= (current_timestamp at time zone 'America/Sao_Paulo')::date)) as novo
) f;
```

  (Ensaiada no staging a 20/11: 1059 / 1059 / 0 / 1059.)
- **Divergência:** **PARAR e diagnosticar**; não reverter automaticamente.
  O rollback repõe o erro de visibilidade e **preserva o ACL vigente**, por
  isso não corrige uma divergência de ACL. Reverter só com REF próprio e o
  SHA-256 do `0029_…rollback.sql` confirmado.
- **Efeito no app:** nenhuma linha visível desaparece (o filtro novo é um
  superconjunto). Lock exclusivo breve só na vista; sem reescrita de dados.

### 9b. 0028 — orçamento persistente das APIs pagas (condicional)

- **Só é precisa** se em produção correrem colectores pagos (Google Places)
  com `--budget=persistent`. Por omissão (`--budget=memory`) a produção não
  depende dela.
- **A 0028 sozinha não chega (fail-closed):** cria `staging.api_budget_config`
  **sem linhas**, e sem linha para o fornecedor a RPC recusa **todas** as
  reservas. Ordem obrigatória, primeiro no staging e depois em produção:
  1. aplicar a 0028 (procedimento `reviews/L5-0028-APLICACAO-STAGING-PO.md`);
  2. o PO aprova os tectos (estimativa de custo:
     `reviews/ESTIMATIVA-CUSTO-0028-PLACES.md`) e aplica a configuração com
     REF próprio (`scripts/staging/api_budget_config.seed.example.sql`);
  3. validar no staging que uma reserva dentro do tecto é aceite e que uma
     acima do tecto é recusada, **antes** de activar `--budget=persistent`;
  4. em **produção**, antes de activar o colector, confirmar só por leitura
     a configuração efectiva (revisão r1 do #40: com `hard_stop_enabled =
     false` a RPC deixa reservar acima do tecto, mesmo que o ensaio no
     staging tenha passado):

```sql
select provider, monthly_budget_usd, daily_budget_usd, per_run_budget_usd,
       hard_stop_enabled, alert_thresholds_pct
from staging.api_budget_config where provider = 'google_places';
-- esperado: 1 linha; os três tectos = os aprovados pelo PO; hard_stop_enabled = true.
-- 0 linhas → tudo recusado (fail-closed); hard_stop_enabled = false → PARAR.
```
- **Hashes:** depois da aplicação no staging, registar em `APPLIED.sha256`
  os SHA-256 (LF) da migração e do rollback; em produção, confirmá-los antes
  de cada execução (o SQL tem de ser o ensaiado).
- **Rollback apaga** o histórico de gasto e os tectos (ver o cabeçalho do
  `0028_…rollback.sql`). Antes de reverter: confirmar com o PO se devem ser
  preservados; se sim, exportar as duas tabelas e **verificar o export**
  (contagens iguais às das tabelas) antes do DROP.

### 9c. Pendências antes da W1 (estado a 20/11/2026, com as decisões do PO)

| Item | Estado | Quem |
|---|---|---|
| Auditoria E2 da produção (só leitura; CSV) + consulta "Antes" da 9a | por fazer | PO autoriza |
| Ensaio da 0026 no staging (secção 3, passo 4) | **autorizado** (20/11): só staging, terminando no estado 0025 (aplicar → verificar → rollback → verificar). Pré-condições: **passam**. Linha de base do catálogo: auditoria v2 com 387 linhas, md5 `88ede4ce…`, 0 ATENCAO/FALTA. Procedimento: `reviews/PROCEDIMENTO-0026-STAGING.md` | operador executa as escritas; Claude verifica |
| 0028 no staging + tectos | **fora da janela inicial**. Tectos aprovados para depois: USD 2 por execução e USD 15/mês; o diário ("5") ainda por clarificar: a 0028 só limita em USD, não por número de execuções | PO |
| Decisão 9b (colectores pagos em produção?) | **decidido (20/11): não no primeiro go-live**. A 0028 não entra na W1 | — |
| #19 em `main` | sem conflitos desde a sincronização (#39) | PO autoriza |
