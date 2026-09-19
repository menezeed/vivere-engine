# Snapshot de Métricas — Regional Baseline (Brooklin)

**Região:** Brooklin, São Paulo (`sp_brooklin_pilot`)
**Produto:** `vivere-60-mais`

Este ficheiro é um registo de dados (métricas de uma execução), não uma
decisão de arquitectura nem um princípio — não introduz um quarto tipo
de documento; é o mesmo espírito do `dry-run-snapshots/*.json` já
existente, só que junta os números para comparação humana directa
entre execuções, em vez de ficar disperso pelos logs.

---

## Execução A — Reprocessamento (`reprocess-venues-from-raw.ts`)

| Campo | Valor |
|---|---|
| `IngestionRun ID` | `19e2e57c-c21d-42a5-927f-132f127fac6b` |
| Origem dos dados | `raw_venue_items` já persistidos (execução real anterior, falhada no passo de staging antes da ADR-0022) |
| Regras de filtro (`00-filter-venue`) | Inalteradas desde a Fase 8 — nenhum Mini PR desta sessão tocou `products/vivere-60-mais.ts` nem `ruleEngine.ts` |
| Custo | USD 0,00 (zero chamadas à Google Places) |

| # | Métrica | Valor |
|---|---|---|
| 1 | `raw_venue_items` lidos | 102 |
| 2 | *Staged* em `venues_staging` | 99 |
| 3 | Rejeitados (tipo/*keyword*) | 3 |
| 4 | `outside_region` (contagem / %) | 23 / 23,2% |
| 5a | `inside_radius` | 71 (71,7%) |
| 5b | `buffer_zone` | 5 (5,1%) |
| 5c | `outside_region` | 23 (23,2%) |
| 6 | Duplicados por nome (dentro do *staged*) | 1 par ("Centro Social Brooklin Paulista" — `buffer_zone` + `inside_radius`) |
| 7 | Duração | 1427ms |
| 8 | Custo | USD 0,00 |
| 9 | *False Positive Rate* (Human Review) | N/A — ninguém passou por Human Review ainda. Fica registado para quando Human Review começar; **não implementar antes disso ter acontecido de facto** (Princípio 5). |

---

## Execução B — Ingestão real nova (`ingest-google-places.ts --region=sp_brooklin_pilot`)

| Campo | Valor |
|---|---|
| `IngestionRun ID` | `cb4b0a10-aff6-4f81-9d37-18876fc263cb` |
| Regras de filtro | Inalteradas — mesma versão da Execução A |
| Custo | USD 2,13 |

| # | Métrica | Valor |
|---|---|---|
| 1 | `raw_venue_items` coletados (bruto, API) | 112 |
| 2 | *Staged* NOVOS em `venues_staging` | 17 (92 já existiam — `ON CONFLICT`, idempotência confirmada) |
| 3 | Rejeitados (tipo/*keyword*) | 3 |
| 4 | `outside_region` entre os 17 genuinamente novos | 2 (11,8%) |
| 5a | `inside_radius` (dos novos) | 15 (88,2%) |
| 5b | `buffer_zone` (dos novos) | 0 (0%) |
| 5c | `outside_region` (dos novos) | 2 (11,8%) |
| 6 | Duplicados por nome (conjunto combinado A+B) | 1 par — mesmo de sempre ("Centro Social Brooklin Paulista"), nenhum novo |
| 7 | Duração | Não registada — ver Backlog Técnico |
| 8 | Custo | USD 2,13 |
| 9 | *False Positive Rate* | N/A |

### Estado combinado final em `venues_staging` (Opção A + Opção B)

| `geographic_status` | Contagem | % |
|---|---|---|
| `inside_radius` | 86 | 74,1% |
| `buffer_zone` | 5 | 4,3% |
| `outside_region` | 25 | 21,6% |

---

## Leitura — Conclusões da Fase 9

**1. A arquitectura foi validada — determinismo formalmente confirmado.** Reprocessamento funciona; idempotência funciona (`ON CONFLICT` confirmado a impedir duplicação real entre dois caminhos de escrita diferentes — reprocessamento e ingestão ao vivo). Uma terceira execução de reprocessamento, desta vez sobre os 214 `raw_venue_items` combinados (102 da Execução A + 112 da Execução B), confirmou três propriedades em simultâneo:
- **Classificação consistente**: `rejected: 6 = 3+3` e `geoExcludedCount: 43 = 23+20` — exactamente aditivo entre as duas execuções, prova de que o filtro e o *Geographic Gate* decidem sempre da mesma forma para os mesmos dados, independentemente de quando ou em que lote foram lidos.
- **Convergência de estado**: `attempted: 208, inserted: 0` — mesmo lendo o dobro dos dados brutos (com sobreposição massiva de venues reais), o resultado em `venues_staging` converge para exactamente o mesmo estado, item a item.
- **Separação de responsabilidades demonstrada, não só desenhada**: `raw_venue_items lidos: 214` (não 116) confirma que a Camada A **nunca deduplica entre execuções de coleta diferentes** (a chave de conflito ali inclui `ingestion_run_id`, sempre novo) — preserva histórico completo. A Camada B (`venues_staging`), com chave de conflito por `place_id`, representa sempre o **estado actual**. **A Camada A preserva histórico; a Camada B representa o estado actual** — esta separação, definida por desenho desde a Fase 8, ficou confirmada por evidência real, não só por arquitectura no papel.

Este era o maior risco técnico da Opção A, e está resolvido.

**2. O Regional Geographic Gate mostrou estabilidade.** As proporções `inside_radius`/`buffer_zone`/`outside_region` mantiveram-se muito próximas ao longo de três medições independentes (dry-run original, reprocessamento, ingestão nova), com tamanhos de amostra diferentes (99, 112, 116). Isto aumenta a confiança de que o *gate* está a capturar um comportamento real da região, não a reagir ao acaso de uma amostra específica.

**3. A nova ingestão confirmou alta reutilização dos dados já persistidos (82%) e acrescentou 17 novos venues, dos quais 15 elegíveis para a região.** Isso demonstra que o reprocessamento gratuito captura a maior parte do valor das evoluções da Engine, enquanto a nova ingestão passa a ter como principal função incorporar alterações recentes da fonte.

**4. Decisão operacional formal para a Fase 9:** a Opção A (reprocessamento) não é apenas um mecanismo de economia de custos — passa a ser a **primeira etapa obrigatória de validação sempre que a Engine evoluir** (mudança de regras, correcção de bug, ajuste ao *gate* geográfico). Só depois de reprocessar e medir é que se decide se uma nova coleta paga é justificada. Fluxo:

```
Engine evoluiu (regra, bug fix, gate)
        ↓
Reprocessar raw_venue_items existentes (custo zero)
        ↓
Medir (as 8 métricas deste snapshot)
        ↓
Só então decidir: nova coleta paga é necessária?
```

---

## Backlog Técnico (registo, sem ADR nem Mini PR)

- `ingest-google-places.ts` ainda não regista `durationMs` — `reprocess-venues-from-raw.ts` já tem; falta trazer o mesmo padrão para os outros dois scripts, quando fizer sentido mexer neles por outro motivo.
- `raw_venue_items` não deduplica entre execuções de coleta diferentes (confirmado: 102+112=214 linhas para ~112 venues reais distintos) — comportamento correcto e intencional (preservação de histórico), mas o volume cresce proporcionalmente ao número de *coletas*, não ao número de *venues únicos*. Monitorizar se o crescimento se tornar significativo à medida que mais regiões/reingestões se acumularem.

---

## Limitação conhecida, registada — não accionada agora

A decisão do filtro por item (`accepted`/`needs_review`/`rejected`/*ambiguity fallback*, por regra específica) **não fica persistida** em `venues_staging` — só `proposal_status` (sempre `pending_review` até revisão humana) e `geographic_status` (ADR-0022). Só é visível ao vivo, no output de um `--dry-run`.

**Decisão explícita desta sessão:** não alterar o modelo agora. Se, depois de algumas regiões, esta informação fizer falta real para auditoria ou ajuste de regras — não só "seria interessante ter" — abre-se uma ADR dedicada nessa altura, com a evidência concreta que a justifique.
