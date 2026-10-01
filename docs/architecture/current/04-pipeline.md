# Pipeline

**Revisto em 2026-10-01 (Activity 14/26, Fase 14B)** — a versão anterior
deste documento listava um esqueleto conceptual de 9 etapas ("Venue Filter",
"Structured Parser", "Narrative Parser", "Venue Resolution", "Category
Classification", "Recurrence", "Business Rules", "Confidence Score") nunca
preenchido com a implementação real. Confirmado por inspecção directa do
código (Activity 13/14): "Category Classification", "Business Rules" e
"Confidence Score" **nunca existiram como código** — eram etapas
conceptuais do planeamento inicial, nunca implementadas. Este documento
descreve agora o pipeline tal como existe hoje no repositório.

## Activity Discovery — etapas reais

```
Source
  → Collector
  → Structured/Narrative Parsing
  → Recurrence Detection
  → Raw Persistence
  → Staging
  → Entity Resolution
  → Human Review
  → Publishing Boundary
```

### 1. Source → Collector

Implementação: `src/collectors/<fonte>/` (`wordpress-content/`,
`prefeitura-agenda-cultural/`, `google-places/`). Cada Collector conhece
uma tecnologia de fonte (WordPress REST API, Google Places API), nunca uma
cidade ou produto específico — ver `05-collectors.md`.

Saída: `RawActivityItem[]` (Activities) ou `RawVenueItem[]` (Venues), em
memória, nunca persistido nesta etapa. Erros de coleta vão para
`collected.errors[]`, nunca para `items[]`.

### 2. Structured/Narrative Parsing

Implementação: `structuredBlockParser.ts` / `narrativeFallbackParser.ts`,
dentro de cada `collectors/<fonte>/parsers/`, orquestrados por
`mapToRawActivityItems.ts`.

Produz `occurrences`, `venue_mention`, `raw_payload.extraction_method` e
`raw_payload.review_reasons`. Um post sem evidência suficiente nunca produz
um item — vai para `errors[]` com `status: 'ambiguous'` ou `'not_found'`.

### 3. Recurrence Detection

Implementação: `src/pipeline/stages/02-recurrence-detection/detectRecurrence.ts`.

Função pura, em memória, sem acesso a base de dados. Recebe
`RawActivityItem[]`, devolve `RecurrenceDetectedItem[]` — nunca muta o item
de entrada (devolve um objecto novo quando detecta recorrência, a mesma
referência quando não detecta nada). Ver contrato completo em ADR-0018,
secção "Revisão 2026-10-01".

Dois estágios adicionais de `pipeline/stages/` existem para o fluxo de
**Venues**, não Activities: `00-filter-venue` e `01-geographic-gate`
(ADR-0022, Regional Geographic Gate). Não fazem parte do caminho de
Activity Discovery.

### 4. Raw Persistence

Implementação: `IngestionOrchestrator.runActivityIngestion()` →
`RawActivityItemRepository`. Escreve `raw_activity_items`, append-only —
nunca sofre `UPDATE` nem `DELETE`. Falha de escrita propaga excepção; a
`IngestionRun` correspondente é marcada `failed`.

### 5. Staging

Implementação: `ActivityStagingRepository.insertBatch()`. Escreve
`activities_staging` com:
- `proposal_status = 'pending_review'` (valor inicial, fixo no código)
- `venue_resolution_status = 'unresolved'` (valor inicial, fixo no código)
- `recurrence_type`/`recurrence_days`/`recurrence_time` copiados tal como
  a etapa anterior produziu

Idempotência: `upsert(onConflict: raw_activity_item_id, ignoreDuplicates:
true)` — uma reingestão da mesma actividade real **nunca** sobrescreve uma
linha de staging já existente, logo nunca reverte uma decisão humana já
tomada. Confirmado para este único caminho de escrita; nenhum outro
escritor potencial de `activities_staging` foi auditado.

### 6. Entity Resolution

Implementação: `src/entity-resolution/` (`EntityResolutionEngine`).
Política de idempotência definida em ADR-0013: re-resolve enquanto não há
decisão humana registada; nunca reprocessa `matched`/`proposed_new`
decididos, salvo acção explícita "Re-resolver" no Admin Panel.

Actualiza `venue_resolution_status` para `'matched'`, `'proposed_new'` ou
`'ambiguous'`. Decisão humana final de `matched` é registada em
`venue_resolution_decisions` (Level 2, 2026-09-26) — ortogonal à decisão
sobre o conteúdo da própria actividade (ver etapa 7).

### 7. Human Review (conteúdo da Activity)

Implementação: `ReviewService` + `ActivityReviewRepository`.

Máquina de estados (`proposal_status`):

```
pending_review --approve--> approved --promote--> promoted
pending_review --reject--> rejected
approved --reject--> rejected
rejected: terminal
promoted: terminal
```

`approve`/`reject`: papéis `reviewer` ou `admin`. `promote`: só `admin`.
Transição inválida lança excepção explícita.

### 8. Publishing Boundary

Implementação: `PublishableActivityRepository.findUnpublished()` /
`findDirty()`. Desde o commit `881c1cd` (Activity 13), ambas exigem:

```
proposal_status = 'promoted'
AND venue_resolution_status IN ('matched', 'proposed_new')
AND promoted_activity_id IS NULL   -- (findUnpublished) | IS NOT NULL (findDirty)
```

Resolução de venue **nunca**, sozinha, torna uma actividade publicável.
Ver ADR de *Discovery V1 Freeze* para o invariante completo de segurança.

A partir daqui, o contrato de Publishing (`ActivityPublisher`,
`PublicationTransformer`, ADR-0018, ADR-0020) já está definido em
documentação própria e não é redefinido aqui.

## Regras que permanecem válidas

- Nenhuma etapa modifica a saída da etapa anterior in-place.
- A UI nunca recalcula resultados do Engine.
- Promotion nunca é automática (`proposal_status='promoted'` exige acção
  humana explícita de `admin`).
