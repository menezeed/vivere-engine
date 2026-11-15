# Runbook — Execução manual assistida da ingestão (E4)

**Estado:** em vigor (opção D do ADR rascunho do agendador). Sem agendamento.
**Âmbito:** ingestão de conteúdo WordPress por região, em **staging**. Produção bloqueada (envGuard). APIs pagas (Google Places) recusadas até ao L5.

---

## 1. O que é

`scripts/run-assisted.ts` envolve o comando por região do E5 (`runRegionIngestion`) com:

| Peça | O que garante |
|---|---|
| Pré-voo (`--preflight`) | verifica, **sem rede**, região, fontes, alvo do envGuard, árvore git e janela de re-execução |
| Lock por região | duas execuções da mesma região não correm ao mesmo tempo nesta máquina |
| Retry limitado | só erros transitórios dos pedidos WordPress (HTTP 408/429/5xx, falhas de rede temporárias), com backoff exponencial |
| Isolamento por fonte | uma fonte que falha não interrompe as outras (E5, PR #14) |
| Manifesto JSON | registo auditável de cada execução em `runs/manifests/` (ignorado pelo git) |

## 2. Procedimento

Pré-requisitos: E0-4 cumprido (a chave de serviço do STG num ficheiro **fora do repositório** ou num cofre local); árvore git limpa no commit que se quer correr.

1. **Actualizar e confirmar o commit**
   ```sh
   git switch main && git pull --ff-only
   git status            # tem de estar limpo
   ```
2. **Pré-voo** (não faz pedidos de rede, não grava nada):
   ```sh
   npx tsx --env-file=<ficheiro-fora-do-repo> scripts/run-assisted.ts --region cabo_frio --preflight
   ```
   Todas as linhas têm de estar `OK` (ou `--`/`AVISO`). Qualquer `FALHA` → **parar** e corrigir.
3. **Dry-run** (recolhe das fontes e calcula L4/E7, sem cliente Supabase):
   ```sh
   npx tsx scripts/run-assisted.ts --region cabo_frio --dry-run --since-days=30
   ```
   Rever o resumo: itens recolhidos, % sem data, alertas E7.
4. **Execução real** (grava em staging):
   ```sh
   npx tsx --env-file=<ficheiro-fora-do-repo> scripts/run-assisted.ts --region cabo_frio --since-days=30
   ```
5. **Registar**: o resumo final indica o caminho do manifesto. Guardar o `run_id` na nota de operação.

Opções úteis:

- `--source <source_key>` (repetível) — corre só essas fontes da região (por exemplo, repetir só a que falhou).
- `--force-rerun` — permite repetir uma execução real recente (ver secção 4).
- `--allow-paid` — é aceite mas **não tem efeito**: as fontes pagas são sempre recusadas nesta fase, com mensagem explícita.

Regiões com fontes WordPress: `cabo_frio`, `sao_pedro_da_aldeia`, `buzios`, `rio_das_ostras`. As outras só têm Google Places e são recusadas.

## 3. Registo auditável (manifesto)

Ficheiro `runs/manifests/<run_id>.json`, um por execução (incluindo as **recusadas**; o `--preflight` sozinho não grava). Campos:

- `run_id` (`<início UTC>_<região>_<sufixo>`), `started_at` / `finished_at` (UTC);
- `git.commit` e `git.dirty`;
- `region`, `dry_run`, `since_days`, `target_environment` (**só o rótulo** `staging`, nunca o URL nem a chave);
- `sources_attempted` e `sources[]` com `status` `ok` / `failed` / `skipped`, `error_class`, mensagem sanitizada, `retries`, contagens e `ingestion_run_id`;
- `totals`, `quality` (L4), `health` (E7), `preflight` (checklist), `outcome`, `exit_code`, `reason`.

Garantias: o manifesto nunca lê o ambiente. Todas as strings passam por um sanitizador (URLs reduzidos ao host; `sb_secret_…`, JWT, `apikey=`, `Bearer …` mascarados). Se algum padrão proibido sobreviver, o manifesto **não é gravado** (fail-closed).

## 4. Idempotência — o que é e o que não é garantido

- **Garantido pelas chaves:** repetir o mesmo lote dentro do **mesmo** `ingestion_run` é um no-op (`raw_activity_items`: `ON CONFLICT (source_key, source_item_id, ingestion_run_id) DO NOTHING`; `activities_staging`: `UNIQUE (raw_activity_item_id)`).
- **Não garantido pelas chaves:** cada execução abre um `ingestion_run` **novo**, e a Camada A é append-only **por execução**. Repetir a mesma janela grava linhas novas.
- **Por isso o pré-voo bloqueia** a re-execução: se um manifesto local mostra uma execução real com a mesma fonte `ok` nas últimas 20 h, a execução é recusada. Para repetir de propósito: `--force-rerun` (fica registado como `AVISO` no manifesto).
- **Limite:** esta guarda só vê os manifestos **desta máquina**. Ver a questão em aberto Q3.

## 5. Falhas

| Código | Significado | Acção |
|---|---|---|
| 0 | tudo ok | nada |
| 1 | pelo menos uma fonte falhou, ou erro inesperado | ver `error_class` no resumo/manifesto |
| 2 | saúde E7 `critical` (por exemplo, zero itens) | rever alertas; confirmar a fonte no browser |
| 3 | recusado (pré-voo ou lock ocupado) | ler a linha `FALHA` do pré-voo |

Por `error_class`:

- `http_transient` / `network_transient` — já houve retry (até 3 tentativas, 2 s → 4 s). Esperar e repetir **só essa fonte**: `--source <key> --force-rerun`.
- `http_permanent` (4xx) — a fonte mudou (URL, categoria, bloqueio). Não repetir; abrir issue.
- `network_permanent` — DNS ou certificado; confirmar se o site mudou.
- `env_guard` — o ambiente não é o staging válido. **Nunca** contornar.
- `persistence` — erro a gravar no staging; não repetir sem perceber a causa (a execução fica `failed` em `ingestion_runs`).

**Lock ocupado:** se a mensagem disser que há uma execução em curso mas tem a certeza de que não há, confirme o `pid` indicado; o lock de um processo morto ou com mais de 6 h é substituído automaticamente. Em último caso, apague `runs/locks/<região>.lock`.

## 6. Evolução para GitHub Actions — checklist de activação

O modelo está em `docs/operacao/agendador/ingest-wordpress.workflow.yml.example` (não activo: está fora de `.github/workflows/`). Só `workflow_dispatch`; `schedule` comentado; `concurrency` por região; `permissions: contents: read`; `environment: staging`; guarda contra produção.

Antes de o activar (cada ponto com decisão registada):

- [ ] **PO — onde vive a chave do STG** (Q1): Environment secret `STAGING_SUPABASE_SERVICE_KEY` do environment `staging`, ou outra opção (VM/cofre, Edge Functions).
- [ ] **PO — aprovação** (Q2): reviewers obrigatórios no environment `staging`; restringir o environment ao branch `main`.
- [ ] E0-4 feito (chave do STG rodada; `.env` fora do repo) e E0-1 (separação STG/PRD).
- [ ] Chave do STG **dedicada** ao Actions (rodável sem afectar a máquina do operador).
- [ ] `main` protegido; nenhum workflow com `pull_request_target`; revisão de segurança do ficheiro.
- [ ] Actions fixadas por SHA de commit.
- [ ] Logs: o orquestrador regista mensagens de erro em bruto (incluem URLs públicos das fontes) no stdout; num repo público os logs são públicos. Confirmar que é aceitável ou reduzir o logger antes de activar.
- [ ] Artefacto: o manifesto só tem agregados; retenção 30 dias.
- [ ] Janela de re-execução: o runner é efémero, logo a guarda local não tem histórico; o `concurrency` evita execuções simultâneas, mas não repetições. Decidir (Q3).
- [ ] Primeira execução em `dry_run: true`; depois real, manual; só depois descomentar o `schedule` (decisão do PO sobre a frequência).
- [ ] APIs pagas: **nunca** neste workflow até o L5 estar aplicado e testado no STG.

## 7. Questões em aberto para o PO

- **Q1.** Aceitar a chave do STG como Environment secret de um repo público, ou optar pela VM/cofre (opção C)?
- **Q2.** Quem aprova as execuções no environment `staging` e se a aprovação é exigida em cada execução.
- **Q3.** Re-execução da mesma janela: manter a Camada A append-only por execução (e confiar na guarda local + disciplina), ou acrescentar deduplicação entre execuções (exige consulta ao staging antes de gravar, ou alteração de chave/migration).
- **Q4.** Frequência por fonte quando houver agendamento (proposta: diária às 06:00 UTC; semanal chega para a frescura medida).
- **Q5.** Política de alertas: só falha do job e E7 `critical`, ou também `warning`.
