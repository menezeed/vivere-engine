# Snapshot de Métricas — Regional Baseline (Moema)

**Região:** Moema, São Paulo (`moema`)
**Produto:** `vivere-60-mais`
**3ª Regional Baseline** — ver `moema-planning.md` (hipótese) e `moema-definicao-operacional.md` (centróide/raio)

---

## Execução — Dry-run + Ingestão real

| Campo | Valor |
|---|---|
| `IngestionRun ID` | `cf472d41-e5f7-4459-842f-3b25f3c8cdf8` |
| Regras de filtro | Inalteradas |
| Custo (dry-run + ingestão) | USD 1,57 + USD 1,57 ≈ USD 3,14 |

| # | Métrica | Valor |
|---|---|---|
| 1 | `raw_venue_items` coletados | 69 |
| 2 | *Staged* genuinamente novos | 42 |
| 2b | Já existentes — sobreposição com Brooklin | 18 |
| 2c | Já existentes — sobreposição com Campo Belo | 8 |
| 2d | **Sobreposição total (Brooklin + Campo Belo)** | **26 de 68 elegíveis (38,2%)** |
| 3 | Rejeitados (tipo/*keyword*) | 1 |
| 4 | `outside_region` (dos novos) | 4 (9,5%) |
| 5a | `inside_radius` (dos novos) | 37 (88,1%) |
| 5b | `buffer_zone` (dos novos) | 1 (2,4%) |
| 5c | `outside_region` (dos novos) | 4 (9,5%) |
| 6 | Duplicados por nome | Não medido nesta ronda — mesmo padrão do backlog já registado |
| 7 | Duração | 11.240ms |
| 8 | Custo | ≈ USD 3,14 |
| 9 | *False Positive Rate* | N/A |

---

## Hipótese principal — resposta confirmada

> "O modelo de Regional Baselines continua correcto quando três regiões vizinhas (Brooklin, Campo Belo, Moema) partilham naturalmente o mesmo ecossistema urbano?"

**Sim — sobreposição tripla real, confirmada numericamente, sem falha de integridade.** Dos 68 venues elegíveis que a coleta de Moema devolveu:
- **18 (26,5%)** já existiam via **Brooklin**
- **8 (11,8%)** já existiam via **Campo Belo**
- **42 (61,8%)** eram genuinamente novos

`ON CONFLICT` por `place_id` (sem região na chave) continuou a garantir exactamente um registo por *venue*, preservando corretamente o `geographic_status` da região que descobriu primeiro em cada caso — nenhuma duplicação, nenhum erro, nenhum comportamento inesperado.

## Comparação de sobreposição entre baselines

| Baseline | Sobreposição com anteriores | Regiões sobrepostas |
|---|---|---|
| Campo Belo | 29,5% | Brooklin (só) |
| Moema | 38,2% | Brooklin + Campo Belo (ambas) |

A taxa sobe de Campo Belo para Moema — coerente com a expectativa: Moema tem duas vizinhas já cobertas, Campo Belo só tinha uma quando foi ingerida. Isto sugere que a taxa de sobreposição tende a subir à medida que mais regiões adjacentes se acumulam, tal como já antecipado no Risco 1 (`scaling-risks-analysis-v1.md`).

## Critérios de sucesso — avaliação

1. **Pipeline permanece determinístico com descoberta tripla** — ✅ confirmado, `ON CONFLICT` comportou-se exactamente como esperado
2. **`ON CONFLICT` garante unicidade sem excepção** — ✅ confirmado, nenhuma duplicação encontrada
3. **Sobreposição observada confirma o modelo continua válido** — ✅ confirmado, com dados reais de três regiões distintas
4. **Comportamento inesperado gera decisão arquitectural** — não accionado; nada inesperado apareceu

## O que isto NÃO resolve — Risco 1 continua em aberto

A confirmação de que o modelo **funciona tecnicamente** com sobreposição tripla não resolve a pergunta de **produto** já registada: quando um utilizador abre Moema, ele vê os 26 venues que "pertencem" tecnicamente ao Brooklin/Campo Belo? A decisão entre os Cenários A/B/C (`campo-belo-planning.md`) continua adiada — mas agora com mais um ponto de dados (taxa a subir de 29,5% para 38,2%), o que reforça o critério já definido para retomar essa decisão: "se subir para 50-60%, a pressão fica muito mais forte".

---

## Backlog Técnico (registo, sem ADR nem Mini PR)

- Duplicados por nome não medidos nesta ronda — mesma pendência já registada nas baselines anteriores
- A taxa de sobreposição crescente (29,5% → 38,2%) reforça, com um segundo ponto de dados, o gatilho já definido no Risco 1 — ainda não atingiu o limiar de 50-60% que tornaria a decisão urgente, mas a tendência está clara
