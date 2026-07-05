# ADR-0012 — Candidate Selection Before Matching

**Status:** Aceito
**Data:** 2026-07-05
**Decisores:** Eduardo Menezes

---

## Contexto

O Architecture Book v1.1 define o pipeline de Entity Resolution como:

```
CandidateGenerator → Matchers → HybridScoreCalculator → ThresholdClassifier
```

Com 160 venues actuais, calcular NameMatcher + GeoMatcher + AddressMatcher
para todos os candidatos é trivial. Com 20.000 venues — cenário realista após
um ano de operação com múltiplas cidades e produtos — calcular scores para
todos os candidatos seria computacionalmente inaceitável.

O problema não é o custo de cada matcher individualmente. É que sem filtragem
prévia, a complexidade é O(n) onde n é o tamanho total do pool de candidatos,
independentemente de quantos deles são geograficamente ou categoricamente
relevantes para a actividade em questão.

---

## Decisão

**Introduzir um CandidatePreFilter entre o CandidateGenerator e os Matchers.**

O pipeline passa a ser:

```
CandidateGenerator
        │
        ▼
CandidatePreFilter          ← novo componente
        │
        ▼
Matchers (Name/Geo/Address)
        │
        ▼
HybridScoreCalculator
        │
        ▼
ThresholdClassifier
```

**Três responsabilidades distintas e separadas:**

| Componente | Responsabilidade | O que nunca faz |
|---|---|---|
| CandidateGenerator | Consultar o pool bruto (approved + promoted, mesmo product_key) | Filtrar, calcular scores |
| CandidatePreFilter | Reduzir o pool a candidatos plausíveis usando heurísticas baratas | Calcular scores, persistir |
| Matchers | Calcular scores de qualidade sobre o conjunto já reduzido | Filtrar, persistir |

---

## CandidatePreFilter — o que faz

O PreFilter aplica filtros baratos sequencialmente, em ordem crescente de custo
computacional, até atingir `maxCandidates`:

1. **Mesmo product_key** — já garantido pelo CandidateGenerator; confirmado aqui
2. **Raio máximo** — Haversine distance simples, sem trigonometria complexa
3. **Mesma cidade** — comparação de string em coluna indexada (`city`)
4. **Categoria compatível** — google_types ou source_category_hint overlap
5. **Top N por score de pré-filtro** — limita o conjunto final

O resultado é um conjunto de no máximo `maxCandidates` venues que os Matchers
vão avaliar com algoritmos mais sofisticados.

---

## CandidateSelectionConfig — configuração injectável

```typescript
interface CandidateSelectionConfig {
  maxCandidates:        number;            // default: 50
  maxRadiusMeters:      number;            // default: 5000 (Cabo Frio); UK pode usar 1500
  allowCrossCity:       boolean;           // default: false
  allowedVenueStatuses: ProposalStatus[];  // default: ['approved', 'promoted']
  categoryBoost:        boolean;           // default: true — prioriza mesma categoria
}
```

**Defaults por contexto:**

| Contexto | maxRadius | allowCrossCity | Justificação |
|---|---|---|---|
| Cabo Frio (default) | 5000m | false | Cidades pequenas, venues espalhados |
| São Pedro da Aldeia | 5000m | false | Mesmo perfil |
| Richmond, London (futuro) | 1500m | false | Alta densidade urbana |
| Multi-cidade (futuro) | 10000m | true | Venues partilhados entre municípios |

**Compatibilidade com ADR-0005 e ADR-0011:** `CandidateSelectionConfig` segue
o mesmo padrão de `ScoringConfig` e `ThresholdConfig` — defaults universais
com override por produto/região, injectado no orquestrador, nunca hardcoded.

---

## O que este ADR protege

**Sem este ADR**, daqui a 2–3 anos, quando existirem 500.000 venues:
- Um developer adicionaria um threshold de score mínimo dentro do NameMatcher
  para "optimizar" — quebrando a responsabilidade única
- Outro adicionaria um `LIMIT` na query do CandidateGenerator com um raio
  hardcoded — tornando o sistema não configurável por produto
- O código acumularia workarounds de performance embutidos nos matchers

**Com este ADR**, a separação é explícita e protegida:
- Performance → CandidatePreFilter (configuração)
- Qualidade → Matchers (algoritmos)
- Política → CandidateSelectionConfig (produto)

---

## Pipeline actualizado (v1.2)

```
EntityResolutionEngine (orquestrador)
    │
    ├── CandidateGenerator
    │       └── consulta pool bruto: approved + promoted, product_key
    │
    ├── CandidatePreFilter                         ← ADR-0012
    │       └── aplica CandidateSelectionConfig
    │           1. raio máximo (Haversine simples)
    │           2. mesma cidade (string compare)
    │           3. categoria compatível (opcional)
    │           4. top N candidatos
    │
    ├── IMatcher[]
    │       ├── NameMatcher     → name_score
    │       ├── GeoMatcher      → geo_score
    │       ├── AddressMatcher  → address_score
    │       └── [futuros matchers]
    │
    ├── HybridScoreCalculator
    │       └── ScoringConfig (pesos injectáveis)
    │
    └── ThresholdClassifier
            └── ThresholdConfig (thresholds injectáveis)
```

---

## Quando o PreFilter é trivial (e continua correcto)

Com 160 venues actuais, o PreFilter pode retornar todos os candidatos sem
filtrar nenhum — e isso é correcto. A interface existe, o contrato está definido,
os defaults são conservadores. O código é idêntico a "sem PreFilter" neste volume.

A diferença aparece quando o volume cresce. O contrato já está correcto desde
o início.

---

## Relação com ADRs anteriores

| ADR | Relação |
|---|---|
| ADR-0004 | Reforçado: CandidateSelectionConfig é configurável por produto |
| ADR-0005 | Extended: terceiro tipo de configuração injectável, mesmo padrão |
| ADR-0010 | Protegido: maxRadius configurável por região (Cabo Frio vs Richmond) |
| ADR-0011 | Extended: separa explicitamente geração / filtragem / cálculo |

---

## Consequências

- O Architecture Book v1.1 é actualizado para v1.2 incorporando este ADR
- `CandidateSelectionConfig` é criado como interface TypeScript na Etapa 3
  (Tipos e Contratos) junto com `ScoringConfig` e `ThresholdConfig`
- O `CandidatePreFilter` é implementado na Etapa 5 (Engine Skeleton)
- Os testes do PreFilter são isolados dos testes dos Matchers — responsabilidades
  distintas, suítes distintas
- Nenhuma migration é necessária — o PreFilter opera em memória sobre dados
  já carregados do banco pelo CandidateGenerator
