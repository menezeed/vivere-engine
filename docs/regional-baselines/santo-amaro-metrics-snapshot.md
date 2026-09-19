# Snapshot de Métricas — Santo Amaro

**Região:** Santo Amaro, São Paulo (`santo_amaro`)
**Produto:** `vivere-60-mais`
**Fase:** Coverage Expansion — primeira execução operacional (não mais validação de arquitectura)

---

## Execução — Dry-run + Ingestão real

| Campo | Valor |
|---|---|
| `IngestionRun ID` | `83396656-39a1-4092-8979-7ca96e36a0b7` |
| Regras de filtro | Inalteradas |
| Custo (dry-run + ingestão) | USD 1,21 + USD 1,23 ≈ USD 2,44 |

| # | Métrica | Valor |
|---|---|---|
| 1 | `raw_venue_items` coletados | 59 |
| 2 | *Staged* genuinamente novos | 43 |
| 2b | Já existentes — sobreposição com Brooklin | 9 |
| 2c | Já existentes — sobreposição com Campo Belo | 3 |
| 2d | Já existentes — sobreposição com Moema | 0 |
| 2e | **Sobreposição total** | **12 de 55 elegíveis (21,8%)** |
| 3 | Rejeitados (tipo/*keyword*) | 4 |
| 4 | `outside_region` (dos novos) | 3 (7%) |
| 5a | `inside_radius` (dos novos) | 37 (86%) |
| 5b | `buffer_zone` (dos novos) | 3 (7%) |
| 5c | `outside_region` (dos novos) | 3 (7%) |
| 6 | Duplicados por nome | Não medido nesta ronda |
| 7 | Duração | 9.856ms |
| 8 | Custo | ≈ USD 2,44 |
| 9 | *False Positive Rate* | N/A |

---

## Pergunta operacional — resposta

> "O processo já consolidado executa sem exigir nenhuma adaptação estrutural?"

**Sim.** Nenhuma mudança de código, configuração além do centróide/raio, ou correcção foi necessária durante todo o ciclo — definição operacional → *dry-run* → revisão → ingestão → *snapshot*. O único obstáculo desta execução foi operacional (aplicação do arquivo de configuração no ambiente Windows, resolvido com um comando PowerShell directo), não estrutural.

## Achado — sobreposição não é uniforme entre vizinhas

Santo Amaro sobrepõe-se com **Brooklin (16,4%)** e **Campo Belo (5,5%)**, mas **não** com Moema (0%), apesar de Moema estar geograficamente mais próxima. Isto reflecte onde os `place_id` específicos devolvidos pela Google coincidem, não uma medida uniforme de proximidade geográfica.

## Comparação de sobreposição entre baselines

| Baseline | Sobreposição | Direcção |
|---|---:|---|
| Campo Belo | 29,5% | referência |
| Moema | 38,2% | subiu |
| **Santo Amaro** | **21,8%** | **caiu** |

A taxa **não é monotonicamente crescente** — quebra a tendência de subida observada entre Campo Belo e Moema. Isto não refuta o Risco 1 (modelo de visibilidade regional ainda não decidido), só confirma que a taxa depende da direcção geográfica específica de cada nova região, não é uma função simples do número de regiões já cobertas. O gatilho de 50-60% definido anteriormente continua válido, sem alteração.

---

## Backlog Técnico

- Duplicados por nome não medidos nesta ronda — mesma pendência recorrente
- Nenhum item novo de backlog surgiu desta execução — reforça a leitura de "execução operacional normal", sem descoberta estrutural nova
