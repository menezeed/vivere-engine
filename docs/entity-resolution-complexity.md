# Entity Resolution — Análise de Complexidade e Performance

**Data:** 2026-07-06
**Contexto:** Documento de referência para as Sprints 7.4–7.13.
**Propósito:** Identificar gargalos futuros antes de escrever algoritmos.

---

## Volumes de referência

| Cenário | Venues no pool | Actividades | Frequência |
|---|---|---|---|
| MVP actual (Julho 2026) | 3 (approved+promoted) | 8 | Manual |
| Piloto Brasil (6 meses) | ~500 | ~200/semana | Diária |
| Plataforma madura (1 ano) | ~5.000 | ~1.000/semana | Automática |
| Escala futura (2+ anos) | ~50.000 | ~10.000/semana | Contínua |

---

## Complexidade por etapa

### CandidateGenerator — O(1) amortizado

```
Operação: SELECT * FROM venues_staging WHERE product_key=? AND proposal_status IN (...)
Complexidade: O(1) — query com índice em (product_key, proposal_status)
Resultado: array de N venues

N actual:      ~3
N piloto:      ~500
N matura:      ~5.000
N futura:      ~50.000
```

**Gargalo futuro:** com 50.000 venues, transferir toda a tabela para memória
a cada resolução é ineficiente. Solução futura: paginação do pool ou índice
geoespacial no banco (PostGIS) que entrega candidatos pré-filtrados por raio
directamente do SQL. Não necessário no MVP.

**Latência esperada:** 5–50ms (query com índice, rede Supabase AWS eu-west-1)

---

### CandidatePreFilter — O(n) onde n = tamanho do pool

```
Passo 1 — Raio Haversine:  O(n) — uma distância por candidato
Passo 2 — Cidade (string): O(n) — uma comparação por candidato
Passo 3 — Categoria:       O(n × |tipos|) — overlap de arrays pequenos
Passo 4 — Top N (sort):    O(n log n) — mas n ≤ 50.000 e é em memória
```

**Complexidade dominante:** O(n log n) pelo sort do Passo 4, mas na prática
os passos 1 e 2 eliminam a maioria dos candidatos antes do sort.

**Latência esperada:**

| n (pool) | Latência estimada |
|---|---|
| 3 | < 1ms |
| 500 | < 5ms |
| 5.000 | < 50ms |
| 50.000 | ~200–500ms (aceitável; sort em memória) |

**Gargalo futuro:** com 50.000 venues em locais geograficamente dispersos
(ex: venues de UK + Brasil no mesmo produto), o Haversine sobre todos antes
de filtrar por raio é O(n). Solução futura: pré-filtro por bounding box
(latitude ± delta, longitude ± delta) antes do Haversine exacto — reduz O(n)
para O(k) onde k << n. Documentado para quando o volume justificar.

---

### NameMatcher — O(m × k) onde m = candidatos filtrados, k = tamanho do nome

```
Exact match (normalização):  O(k) por candidato — string ops
Contains match:              O(k) por candidato — substring
Token overlap (Jaccard):     O(|tokens_menção| + |tokens_nome|) — set ops
Trigram similarity:          O(3 × k) — janela deslizante de 3-grams
```

**m é sempre ≤ maxCandidates (50 por defeito)**

**Complexidade dominante:** O(m × k) onde k é comprimento médio do nome.
Com k ≤ 100 caracteres e m ≤ 50: ~5.000 operações simples por actividade.

**Latência esperada:** < 1ms para o conjunto filtrado.

**Não há gargalo futuro** — m é controlado pelo PreFilter. Independentemente
do pool total, o NameMatcher trabalha sempre sobre no máximo 50 candidatos.

---

### GeoMatcher — O(m)

```
Haversine por candidato: O(1) — 6 operações trigonométricas
Total para m candidatos: O(m)
```

**Latência esperada:** < 0.5ms para m ≤ 50. Math.sin/cos em V8 são JIT-compilados.

---

### AddressMatcher — O(m × k)

Mesmo padrão do NameMatcher. k = comprimento do endereço (tipicamente maior
que o nome — endereços podem ter 80–150 caracteres). Mesma ordem de magnitude.

---

### HybridScoreCalculator — O(m × |matchers|)

```
Por candidato: somar scores de |matchers| matchers
|matchers| = 3 no MVP (name, geo, address)
Aplicar boost: O(1)
Clip a [0,1]: O(1)
Total: O(m × 3) = O(m)
```

**Latência esperada:** < 0.5ms. Aritmética pura.

---

### ThresholdClassifier — O(m log m)

```
Aplicar threshold a cada candidato: O(m)
Ordenar por score (ranking):        O(m log m)
Determinar AutoClassification:      O(1)
```

Com m ≤ 50: sort de 50 elementos é trivial (~100ns).

---

### Persistência (Repositórios) — O(m) writes

```
insertCandidates: O(m) — batch insert
updateActivity:   O(1) — update por PK
```

**Latência dominante:** rede Supabase. 1 batch insert de 50 linhas: ~20–100ms.
Este é o componente mais lento do pipeline — não os algoritmos.

---

## Latência total estimada por actividade

| Componente | MVP (3 venues) | Piloto (500) | Madura (5.000) |
|---|---|---|---|
| CandidateGenerator | 10ms | 20ms | 50ms |
| CandidatePreFilter | <1ms | 2ms | 20ms |
| NameMatcher | <1ms | <1ms | <1ms |
| GeoMatcher | <1ms | <1ms | <1ms |
| AddressMatcher | <1ms | <1ms | <1ms |
| HybridScoreCalculator | <1ms | <1ms | <1ms |
| ThresholdClassifier | <1ms | <1ms | <1ms |
| Persistência (write) | 30ms | 30ms | 30ms |
| **Total por actividade** | **~42ms** | **~55ms** | **~105ms** |

**Para 8 actividades (estado actual):** ~336ms total em sequência.
**Para 200 actividades (piloto):** ~11 segundos — aceitável para execução diária.
**Para 1.000 actividades (madura):** ~105 segundos — aceitável para execução
nocturna; paralelismo pode ser introduzido nesta fase (5 actividades em
paralelo → ~21 segundos).

---

## Mapa de gargalos futuros

| Volume | Gargalo | Solução |
|---|---|---|
| > 5.000 venues | CandidateGenerator transfere toda a tabela | Bounding box pré-filtro no SQL |
| > 50.000 venues | PreFilter Haversine lento | Bounding box antes de Haversine |
| > 10.000 actividades/semana | Execução sequencial lenta | Paralelismo com Promise.all em batches |
| > 100.000 venues | Trigram em memória inviável | Delegar similarity ao pg_trgm via SQL |

**Conclusão:** nenhum gargalo é relevante para o MVP ou piloto Brasil.
A arquitectura actual suporta confortavelmente até ~5.000 venues e ~1.000
actividades/semana sem qualquer optimização adicional.

---

## Métricas a recolher desde a primeira execução

Conforme ajuste #5 do roadmap aprovado, cada execução deve registar:

```typescript
interface PipelineMetrics {
  activityId:          string;
  candidatesGenerated: number;    // após Generator
  candidatesFiltered:  number;    // após PreFilter
  preFilterMs:         number;
  nameMatcherMs:       number;
  geoMatcherMs:        number;
  addressMatcherMs:    number;
  hybridMs:            number;
  classifierMs:        number;
  persistenceMs:       number;
  totalMs:             number;
  maxScore:            number;
  avgScore:            number;
  finalClassification: string;
}
```

Estas métricas vão para o log estruturado (pino) e para `match_detail JSONB`
em `venue_resolution_candidates` para análise futura.

---

## Consumo de memória por etapa

### CandidateGenerator

Carrega o pool completo para memória.

| n (venues) | Tamanho de VenueCandidate | Memória estimada |
|---|---|---|
| 3 | ~300 bytes | ~1KB |
| 500 | ~300 bytes | ~150KB |
| 5.000 | ~300 bytes | ~1.5MB |
| 50.000 | ~300 bytes | ~15MB |

**Nota:** 15MB para 50.000 venues é aceitável em Node.js (heap padrão ≥ 1.4GB).
Quando o pool crescer além de 100.000, considerar streaming ou paginação do pool.

### CandidatePreFilter

Opera sobre o array do Generator sem copiar — filtra com `.filter()` e `.slice()`.
Memória adicional: negligenciável (referências, não cópias de objecto).

### Matchers

Cada matcher cria um `MatchScore` por candidato (m ≤ 50).
~200 bytes × 50 = ~10KB por actividade. Negligenciável.

### HybridScoreCalculator

Cria `CandidateScore` por candidato — ~400 bytes × 50 = ~20KB.
Negligenciável.

### PipelineMetrics

~1KB por resolução. Para 1.000 actividades em paralelo futuro: ~1MB.
Aceitável — não mantido em memória após log + persistência.

### Pico de memória por execução de resolveAll()

```
pool_tamanho × sizeof(VenueCandidate)
+ m × sizeof(MatchScore) × n_matchers
+ m × sizeof(CandidateScore)
+ sizeof(PipelineMetrics)
```

Para o MVP (3 venues, 8 actividades, execução sequencial): < 100KB total.
Para plataforma madura (5.000 venues, 200 actividades sequenciais): < 5MB.

---

## Paralelização futura

### Nível 1 — Paralelizar actividades (mais impacto, menor complexidade)

```typescript
// Hoje (sequencial):
for (const activityId of activityIds) {
  await engine.resolve(activityId);
}

// Futuro (paralelo em batches):
const BATCH_SIZE = 10;
for (const batch of chunks(activityIds, BATCH_SIZE)) {
  await Promise.all(batch.map(id => engine.resolve(id)));
}
```

**Quando:** quando resolveAll() exceder 60 segundos (estimado: ~1.000 actividades
com pool de 5.000 venues em execução sequencial).

**Pré-condição:** cada resolução deve ser stateless (já é — nenhum componente
guarda estado entre resoluções). Verificar que o Supabase client suporta
conexões concorrentes sem lock (suporta — pool de conexões).

### Nível 2 — Paralelizar matchers dentro de uma resolução

```typescript
// Hoje (sequencial por matcher):
const nameScore = nameMatcher.score(mention, candidate);
const geoScore  = geoMatcher.score(mention, candidate);
const addrScore = addressMatcher.score(mention, candidate);

// Futuro (paralelo por candidato):
const [nameScore, geoScore, addrScore] = await Promise.all([
  Promise.resolve(nameMatcher.score(mention, candidate)),
  Promise.resolve(geoMatcher.score(mention, candidate)),
  Promise.resolve(addressMatcher.score(mention, candidate)),
]);
```

**Quando:** quando o NameMatcher for delegado ao pg_trgm (query assíncrona).
Actualmente os matchers são síncronos — paralelismo não traz benefício.

### Nível 3 — Worker threads para matchers CPU-intensivos

Apenas relevante se um matcher futuro (ex: EmbeddingMatcher com modelo ML)
tiver latência > 10ms por candidato. Arquitectura actual suporta — matchers
são funções puras sem shared state.

**Quando:** Fase 9+ com modelos de embeddings locais.

---

## Resumo de decisões de performance por volume

| Volume | Acção | Sprint |
|---|---|---|
| Até 5.000 venues | Nenhuma — arquitectura actual suficiente | — |
| 5.000–50.000 | Bounding box pré-filtro no SQL do Generator | Quando necessário |
| 50.000–500.000 | Índice geoespacial PostGIS ou bounding box | Quando necessário |
| Mais de 1.000 actividades/semana | Paralelismo de Nível 1 (batches) | Fase 9 |
| Matchers ML (embeddings) | Worker threads, Nível 3 | Fase 9+ |
