# Relatório de Calibração — Sprint 7.10
**Data:** 2026-07-07 · Produto: vivere-60-mais · Pool: 17 venues promoted

## Resultados do resolveAll

| Mention | Venue no banco | Score | Classificação |
|---|---|---|---|
| Palácio das Águias | Palácio das Águias | **0.938** | ✅ matched |
| Praia do Forte | Praia do Forte | **0.876** | ✅ matched |
| Museu e Casa de Cultura José de Dome (Charitas)... | Museu e Casa de Cultura José de Dome | 0.830 | ⚠ unresolved (sugestão forte) |
| Praça do Moinho | Praça do Moinho | 0.812 | ⚠ unresolved (sugestão forte) |
| Canto do Forte, na Praia do Forte | — | 0.761 | ⚠ unresolved |
| Passagem | — | 0.450 | ❌ proposed_new (correcto) |
| (sem mention) | — | — | unresolved |
| (sem mention) | — | — | unresolved |

## Análise dos casos de sugestão forte

### Praça do Moinho — score 0.812
- nameScore: 1.000 (exact match)
- geoScore: 0.300 (venue a 3.6km do centroide — periferia de Cabo Frio)
- hybridScore: 0.712 + boost 0.10 = **0.812**
- Motivo do score baixo: centroide de Cabo Frio é o centro histórico;
  a Praça do Moinho fica num bairro periférico (3.6km).
- Decisão: manter como unresolved. Revisor humano confirma com 1 clique.

### Museu e Casa de Cultura José de Dome — score 0.830
- nameScore: 0.646 (contains — menção muito mais longa que o nome no banco)
- geoScore: 0.850 (295m do centroide — centro histórico)
- hybridScore: 0.730 + boost 0.10 = **0.830**
- Motivo do score baixo: menção inclui "(Charitas) – Centro de Cabo Frio"
  que dilui o overlap de tokens com o nome curto no banco.
- Decisão: manter como unresolved. Revisor humano confirma com 1 clique.

## Thresholds — decisão de calibração

| Threshold | Valor actual | Avaliação |
|---|---|---|
| highConfidence (matched) | **0.85** | Manter — conservador intencional |
| minSuggestion (unresolved) | **0.50** | Manter |

**Regra permanece:**
- score ≥ 0.85 → matched (requer confirmação humana)
- 0.50–0.84 → unresolved com sugestão (revisor confirma)
- < 0.50 → proposed_new

**Threshold 0.80 como candidato futuro:** avaliar após 100+ decisões humanas
registadas em venue_resolution_decisions. Se ≥ 95% dos casos com score
entre 0.80 e 0.85 forem confirmados pelos revisores, baixar para 0.80.

## Estado do motor

- Pipeline end-to-end: ✅ operacional
- Matches correctos: 2/2 com mention exacta e venue no pool
- Proposed_new correcto: 1/1 (Passagem — venue não existe)
- Sugestões fortes (0.80–0.84): 2 casos aguardam revisão humana na Sprint 7.11/7.12
- GeoMatcher: ✅ funcional (usa candidate.city → getCityCentroid)
- NameMatcher: ✅ exact/contains/trigram conforme esperado

## Próximo passo

Sprint 7.11 — Review API para Entity Resolution.
É justamente a interface de revisão que permitirá ao operador confirmar
os casos de sugestão forte (0.812, 0.830) com um clique.
