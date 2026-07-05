# ADR-0011 — Entity Resolution como Pipeline Modular e Configurável

**Status:** Aceito
**Data:** 2026-07-05
**Decisores:** Eduardo Menezes

---

## Contexto

O Architecture Book v1.0 definiu a arquitectura do Entity Resolution Engine da
Vivere Platform. Antes de iniciar a implementação, foi conduzida uma revisão
arquitectural (Fase 7.1 — Foundation First) que identificou oito pontos a
registar formalmente como decisões arquitecturais antes de qualquer código:

1. Estrutura modular do pipeline
2. Separação de responsabilidades: matchers vs repositórios vs orquestrador
3. Configurabilidade de thresholds e pesos
4. Pool de candidatos correcto
5. Inclusão de product_key nas novas tabelas
6. Substituição do array rejected_candidates por outcome por candidato
7. Adiamento da migration 0011
8. Endpoints da Review API para ER registados no roadmap

Este ADR regista todas estas decisões como restrições arquitecturais que devem
ser respeitadas em toda a implementação da Fase 7.

---

## Decisões

### Decisão 1 — O Entity Resolution Engine é um pipeline de componentes com responsabilidade única

O motor é composto por componentes independentes, cada um com responsabilidade
única e sem conhecimento dos outros:

```
EntityResolutionEngine (orquestrador)
    │
    ├── CandidateGenerator
    │       └── consulta venues_staging via repositório
    │
    ├── NameMatcher
    │       └── calcula name_score para cada candidato
    │
    ├── GeoMatcher
    │       └── calcula geo_score para cada candidato
    │
    ├── AddressMatcher
    │       └── calcula address_score para cada candidato
    │
    ├── HybridScoreCalculator
    │       └── agrega scores parciais com pesos configuráveis
    │
    └── ThresholdClassifier
            └── classifica resultado com thresholds configuráveis
```

**Princípio Open/Closed:** novos matchers (SemanticMatcher, EmbeddingMatcher,
PhoneMatcher) podem ser adicionados sem alterar os existentes. O orquestrador
recebe uma lista de matchers — não conhece nenhum concretamente.

**Isolamento:** nenhum componente acede ao banco de dados. Nenhum componente
conhece Hono. Nenhum componente conhece React. Matchers recebem dados,
devolvem scores. São funções puras testáveis sem qualquer dependência externa.

---

### Decisão 2 — Separação estrita: matchers calculam, repositórios persistem, orquestrador coordena

| Camada | Responsabilidade | Proibido |
|---|---|---|
| Matchers (Name/Geo/Address) | Calcular score parcial | Persistir, ler banco, conhecer outros matchers |
| HybridScoreCalculator | Agregar scores com pesos | Calcular scores parciais, persistir |
| ThresholdClassifier | Classificar resultado final | Calcular scores, persistir |
| CandidateGenerator | Consultar pool de candidatos | Calcular scores, persistir resultados |
| Repositórios (ER) | Persistir runs, candidatos, decisões | Lógica de negócio, cálculo de scores |
| EntityResolutionEngine | Coordenar a sequência | Calcular scores directamente, persistir directamente |

Não existe `PersistenceService` — o nome seria ambíguo com a camada de
repositórios existente. O orquestrador chama os repositórios directamente.

---

### Decisão 3 — Thresholds e pesos são configuração injectada, não constantes hardcoded

Dois tipos de configuração, ambos com defaults e suporte a override por produto:

```typescript
interface ScoringConfig {
  weights: {
    name:    number;   // default: 0.50
    geo:     number;   // default: 0.35
    address: number;   // default: 0.15
  };
  confidenceBoost: {
    explicit_name:          number;   // default: +0.10
    inferred_from_context:  number;   // default:  0.00
    ambiguous:              number;   // default: -0.10
  };
}

interface ThresholdConfig {
  highConfidence: number;   // default: 0.85 — classifica como 'matched'
  minSuggestion:  number;   // default: 0.50 — abaixo disto → proposed_new
}
```

**Justificação:** os valores iniciais são estimativas baseadas em raciocínio,
não em dados. O Architecture Book v1.0 reconhece explicitamente (Capítulo 7)
que devem ser calibrados após 100+ decisões humanas reais. Hardcodar impediria
calibração sem redeploy.

**Compatibilidade com ADR-0005:** segue o mesmo princípio de defaults universais
+ override por produto do Venue Filtering Engine.

---

### Decisão 4 — Pool de candidatos inclui 'approved' e 'promoted'; exclui 'pending_review'

O Architecture Book v1.0 (Capítulo 5.2) restringia o pool a `promoted`.
Esta decisão corrige:

```sql
-- Pool correcto
SELECT * FROM staging.venues_staging
WHERE product_key = $1
  AND proposal_status IN ('approved', 'promoted');
```

**Justificação:** com 1 venue `promoted` e 159 `pending_review` actualmente,
um pool restrito a `promoted` tornaria o ER inutilizável. `approved` significa
que um humano validou o venue — é confiança suficiente para ser candidato.
`pending_review` nunca deve entrar no pool: ainda não foi validado.

**Princípio de segurança:** o ER nunca liga uma actividade a um venue que ainda
não passou pela revisão humana. Apenas venues aprovados ou promovidos.

---

### Decisão 5 — As três novas tabelas de Entity Resolution incluem product_key

Todas as tabelas criadas na Fase 7 incluem `product_key NOT NULL` com índice:

- `staging.venue_resolution_runs` — `product_key` permite filtrar runs por produto
- `staging.venue_resolution_candidates` — derivado da run, mas também indexado
- `staging.venue_resolution_decisions` — permite relatórios de resolução por produto

**Justificação:** queries de observabilidade ("quantas resoluções foram feitas
para vivere-60-mais este mês") e o princípio ADR-0004 (multi-produto) exigem
que product_key seja uma dimensão de primeira classe em todas as entidades.

---

### Decisão 6 — Cada candidato regista o seu próprio outcome; sem arrays rejected_candidates

O Architecture Book v1.0 propunha `rejected_candidates UUID[]` em
`venue_resolution_decisions`. Esta decisão substitui por:

```sql
-- Em staging.venue_resolution_candidates
decision_outcome TEXT CHECK (decision_outcome IN ('accepted', 'rejected', 'skipped')),
decision_id UUID REFERENCES staging.venue_resolution_decisions(id)
```

**Justificação:** arrays UUID em PostgreSQL não são indexáveis eficientemente.
Queries como "qual candidato foi rejeitado mais vezes" — útil para calibração
de thresholds — requerem `unnest()` sem índice. A normalização por linha é mais
eficiente, mais legível, e compatível com o padrão de toda a plataforma (que
nunca usa arrays para relações).

---

### Decisão 7 — Migration 0011 é adiada indefinidamente

A migration 0011 (`ALTER activities_staging ADD COLUMN matched_venue_staging_id`)
não será criada na Fase 7.

**Justificação:** o match confirmado pode ser derivado via JOIN:

```sql
SELECT d.accepted_venue_id
FROM staging.venue_resolution_decisions d
WHERE d.activity_staging_id = $1
  AND d.action = 'matched'
ORDER BY d.reviewed_at DESC
LIMIT 1;
```

A desnormalização para `matched_venue_staging_id` é uma optimização de
performance — não uma necessidade do MVP. Só deve ser criada quando queries de
publicação real revelarem necessidade mensurável.

**Pré-condição para criar 0011:** existir evidência de que o JOIN acima é o
bottleneck real da query de publicação, com dados de volume real.

---

### Decisão 8 — Endpoints da Review API para Entity Resolution são registados no roadmap da Fase 7.5

Os seguintes endpoints serão necessários mas não são implementados agora:

```
GET    /api/entity-resolution/queue?product_key=&status=unresolved
GET    /api/entity-resolution/:activityId/candidates
PATCH  /api/entity-resolution/:activityId/accept   { candidateId }
PATCH  /api/entity-resolution/:activityId/override { candidateId, notes }
PATCH  /api/entity-resolution/:activityId/propose-new { notes }
GET    /api/entity-resolution/stats?product_key=
```

**Justificação:** implementar endpoints antes do motor existir criaria uma API
sem dados. A ordem correcta é: motor → dados → API → painel.

**Impacto no roadmap:** a Fase 7 está estruturada em 8 sprints conforme o
Architecture Book. Os endpoints acima são escopo do Sprint 7.5 (Admin Panel
Entity Resolution Review) — não antes.

---

## Consequências

- A Fase 7 inicia com as migrations 0008, 0009, 0010 (não 0011)
- `ScoringConfig` e `ThresholdConfig` são criados como parte dos tipos (Etapa 3)
  antes de qualquer algoritmo
- O `RepositoryFactory` existente serve de modelo para o
  `EntityResolutionRepositoryFactory` a criar na Etapa 4
- Nenhum matcher tem dependência de Supabase, Hono ou React — testáveis como
  funções puras
- O princípio Open/Closed (novos matchers sem alterar os existentes) é
  garantido pela interface `IMatcher` que todos os matchers implementam

---

## Relação com ADRs anteriores

| ADR | Relação |
|---|---|
| ADR-0001 | Confirmado: ER não toca nos Collectors |
| ADR-0002 | Confirmado: ER consome VenueMention — nunca inventa campos de venue |
| ADR-0003 | Reforçado: thresholds conservadores + revisão humana obrigatória |
| ADR-0004 | Reforçado: product_key em todas as tabelas novas (correcção I3) |
| ADR-0005 | Extended: ScoringConfig segue o padrão defaults + override por produto |
| ADR-0006 | Confirmado: ER opera exclusivamente em staging.* |
| ADR-0009 | Extended: endpoints de ER registados no roadmap da Review API |
| ADR-0010 | Protegido: motor agnóstico de produto/idioma/geografia desde o início |
