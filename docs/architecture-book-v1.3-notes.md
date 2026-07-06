# Nota Técnica — HybridScoreCalculator: Renormalização de Pesos

**Data:** 2026-07-06
**Sprint:** 7.7
**Para:** Architecture Book v1.3 (Sprint 7.13)
**Estado:** Pendente incorporação na próxima versão do documento

---

## Decisão

O `HybridScoreCalculator` **renormaliza os pesos** dos matchers activos quando
algum matcher retorna `null` (sem dados para comparar).

Esta decisão é **intencional e não opcional**.

---

## Motivação

Quando o `AddressMatcher` retorna `null` porque a `VenueMention` não tem
`raw_address_text`, ou o `VenueCandidate` não tem `address`, não existe
informação de endereço para comparar. Penalizar o score híbrido com o peso
do endereço (0.15) resultaria em scores sistematicamente mais baixos para
fontes sem endereço — o que é injusto e incorrecto.

**Princípio:** ausência de dados não é evidência de má qualidade do match.
O matcher simplesmente não tem informação. Os matchers com informação assumem
o peso total.

---

## Fórmula

**Antes (Architecture Book v1.2 — INCORRECTA como descrição da implementação):**
```
hybrid = (name × 0.50) + (geo × 0.35) + (address × 0.15)
```
Com address ausente, tratava efectivamente address como 0:
```
hybrid = (name × 0.50) + (geo × 0.35) + (0 × 0.15) = deflacionado
```

**Depois (implementação real — CORRECTA):**
```
activeWeights = sum(weights of matchers that returned non-null)
hybrid = sum(score_i × weight_i / activeWeights)  for each active matcher
```

Exemplo sem AddressMatcher:
```
activeWeights = 0.50 + 0.35 = 0.85
hybrid = (name × 0.50/0.85) + (geo × 0.35/0.85)
       = (name × 0.5882)    + (geo × 0.4118)
```

---

## Impacto nos exemplos do Architecture Book v1.2

### Exemplo A — BeepYoga Festival → Museu José de Dome (Cap. 8.1)

| | v1.2 (sem renormalização) | Real (com renormalização) |
|---|---|---|
| name score | 0.80 | 0.80 |
| geo score | 0.85 | 0.85 |
| address score | 0.00 (sem dados) | null (ignorado) |
| hybrid score | 0.6975 | 0.8206 |
| boost (explicit_name) | +0.10 | +0.10 |
| **final score** | **~0.80** | **~0.921** |
| **classificação** | **unresolved** | **matched** |

**O exemplo do Architecture Book v1.2 está incorrecto como descrição da implementação.**
O motor classifica BeepYoga como `matched` (score 0.921), não `unresolved`.
Isto é um resultado **mais optimista e mais correcto** — o Museu José de Dome
é o candidato mais plausível e o motor identifica-o correctamente.

### Outros exemplos (Cap. 8.2 e 8.3)

Os exemplos de Yoga no Forte e Arraiá da Praça da Bandeira não são afectados
significativamente porque os scores de name e geo são suficientemente
diferentes para manter as classificações qualitativas (ambiguous e proposed_new).

---

## O que actualizar no Architecture Book v1.3

1. Secção 6.4 (Hybrid Score): substituir fórmula por versão com renormalização
2. Secção 8.1 (BeepYoga): actualizar scores calculados para 0.921 e classificação para `matched`
3. Adicionar nota: "Matchers sem dados são excluídos da ponderação — os pesos dos matchers activos são renormalizados para somar 1"
4. Adicionar à tabela de thresholds (Secção 7): nota sobre o impacto da renormalização

---

## Teste de protecção

O teste `"renormalizes weights when address score is missing"` em
`src/entity-resolution/__tests__/hybrid-threshold.test.ts` protege esta decisão.
Qualquer alteração à lógica de renormalização fará este teste falhar.
