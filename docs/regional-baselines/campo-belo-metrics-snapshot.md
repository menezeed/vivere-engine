# Snapshot de Métricas — Regional Baseline (Campo Belo)

**Região:** Campo Belo, São Paulo (`campo_belo`)
**Produto:** `vivere-60-mais`
**2ª Regional Baseline** — ver `campo-belo-planning.md` (hipótese) e `campo-belo-definicao-operacional.md` (centróide/raio)

---

## Execução única — Ingestão real directa (sem Opção A/B separadas, ao contrário do Brooklin)

Diferente do Brooklin, esta região não passou por reprocessamento de dados de uma execução falhada — foi coleta → *dry-run* de validação → ingestão real, sequência limpa desde o início.

| Campo | Valor |
|---|---|
| `IngestionRun ID` | `6621164d-e40d-43ab-801d-3da7ab0f803c` |
| Regras de filtro | Inalteradas — mesma versão de todas as execuções anteriores |
| Custo | USD 1,75 |

| # | Métrica | Valor |
|---|---|---|
| 1 | `raw_venue_items` coletados (bruto, API) | 90 |
| 2 | *Staged* NOVOS em `venues_staging` | 62 |
| 2b | Já existentes — sobreposição com o Brooklin (`ON CONFLICT`) | **26 (29,5% dos 88 elegíveis)** |
| 3 | Rejeitados (tipo/*keyword*) | 2 |
| 4 | `outside_region` — log bruto, todos os 90 (inclui homónimos MG) | 58 (64,4%) |
| 5a | `inside_radius` — só os 62 genuinamente novos | 7 (11,3%) |
| 5b | `buffer_zone` — só os 62 genuinamente novos | 8 (12,9%) |
| 5c | `outside_region` — só os 62 genuinamente novos | 47 (75,8%) |
| 6 | Duplicados por nome | Não medido nesta ronda — ver Backlog Técnico |
| 7 | Duração | Não registada — mesma lacuna já conhecida (`ingest-google-places.ts` sem `durationMs`) |
| 8 | Custo | USD 1,75 |
| 9 | *False Positive Rate* | N/A |

## Achado específico — homonímia com Campo Belo, MG

8 dos 58 `outside_region` do log bruto são resultados a ~332km de distância — a Google Text Search casou o nome do bairro com a cidade homónima em Minas Gerais ("Casa da Cultura", "Museu Histórico de Campo Belo", "Biblioteca Municipal Dona Carlota", entre outros). O Regional Geographic Gate (ADR-0022) classificou-os correctamente como `outside_region`, sem intervenção manual — comportamento correcto por desenho, registado aqui como característica desta região específica, não como problema a corrigir.

## Achado principal — sobreposição real entre Regional Baselines, medida

Esta é a resposta directa à hipótese principal de `campo-belo-planning.md`:

> "O modelo de Regional Baselines continua correcto quando duas regiões vizinhas partilham naturalmente parte do mesmo ecossistema urbano?"

**Resposta preliminar: sim, com sobreposição real e mensurável.** 26 de 88 venues elegíveis (29,5%) que a coleta de Campo Belo devolveu já existiam em `venues_staging`, descobertos primeiro pelo Brooklin. O `ON CONFLICT` por `place_id` (sem região na chave) preservou correctamente o `geographic_status` original (calculado a partir do centróide do Brooklin) — nenhum dado duplicado, nenhuma escrita perdida.

**Achado secundário:** entre os venues genuinamente novos que só Campo Belo trouxe, a proporção `outside_region` (75,8%) é muito mais alta do que a média bruta (64,4%) — os candidatos mais centrais tendem a já terem sido capturados pelo Brooklin, sobrando para Campo Belo descobrir sobretudo a periferia. Padrão coerente com a hipótese, não uma anomalia.

## Critérios de sucesso (de `campo-belo-planning.md`) — qual se aplica

Dos três critérios definidos antes da coleta:
1. ~~Comportamento correcto, nenhuma alteração necessária~~
2. ~~Limitação tratável em Human Review~~
3. ~~Limitação estrutural que justifica ADR~~

**Nenhum se aplica ainda de forma conclusiva** — o `ON CONFLICT` preservou o dado correctamente (favorece o critério 1), mas a decisão de produto (Cenário A/B/C da hipótese secundária) continua em aberto, à espera de Human Review real sobre estes casos de sobreposição.

---

## Backlog Técnico (registo, sem ADR nem Mini PR)

- Duplicados por nome não foram medidos nesta ronda — query pendente, mesma usada no Brooklin, ainda por correr especificamente sobre Campo Belo
- `ingest-google-places.ts` continua sem `durationMs` — mesma lacuna do Brooklin, ainda não corrigida
