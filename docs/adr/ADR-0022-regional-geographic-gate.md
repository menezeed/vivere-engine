# ADR-0022 — Regional Geographic Gate

**Status:** Aceito
**Data:** 2026-07-15 (revista em 2026-07-15, pós-revisão arquitectural)

---

## Contexto

Durante a validação do Regional Baseline (Brooklin, São Paulo — Fase 9,
Etapa 2 do Regional Expansion Checklist), o dry-run real do Google
Places revelou que **22 de 26 resultados classificados como
`outside_region`** (mais de 3km além do raio configurado) tinham
`decision: ACCEPTED` — incluindo marcos da cidade inteira, muito além de
qualquer bairro (Pinacoteca a ~9,5km, MASP a ~6,3km, Museu Catavento a
~9,5km, Casa Mário de Andrade a ~9,2km).

A causa raiz: o Google Places **Text Search** usa `lat/lng + radius`
como **viés de proximidade**, não como corte rígido — resultados muito
conhecidos "vazam" para muito além do raio configurado, e o Venue
Filtering Engine (`00-filter-venue`) aceita esses resultados **só pelo
`google_types`** (ex: `accept_type_museum`), sem nenhum sinal de
distância. As categorias `museu` e `teatro` tiveram **100% de taxa de
fuga** — todo resultado com o tipo certo foi aceite, estivesse a 3km ou
a 9,5km.

Isto gera custo real de curadoria: cada resultado geograficamente
irrelevante marcado `ACCEPTED` tem de ser rejeitado manualmente em
Human Review, sem nenhuma ajuda do sistema.

**Revisão desta ADR (mesmo dia):** a primeira versão implementada
excluía itens `outside_region` do array antes de `venues_staging`,
nunca chegando lá. Revisão arquitectural apontou que isto contraria o
princípio de "nunca perder evidência" já consolidado na Fase 8 (ex:
ADR-0016 — venues são arquivados, nunca apagados). Corrigido: ver
Decisão.

## Decisão

Um novo estágio de pipeline, **Regional Geographic Gate**
(`src/pipeline/stages/01-geographic-gate`), aplicado **depois** do
Venue Filtering Engine e **antes** da persistência em
`venues_staging`:

```
RawVenueItem[] → raw_venue_items (sempre, Camada A)
              → 00-filter-venue (decisão por tipo/keyword)
              → 01-geographic-gate (esta ADR — nunca remove itens)
              → venues_staging (TODOS os itens, com proposal_status ajustado)
```

### Política

1. **`inside_radius`** (`distance <= radius_m`) — decisão do Venue
   Filtering Engine preservada sem alteração.
2. **`buffer_zone`** (`radius_m < distance <= radius_m + 500`) — se a
   decisão efectiva for `ACCEPTED`, é **forçada para `NEEDS_REVIEW`**,
   com a tag `geographic_buffer_zone` anexada à `reasoning`. Qualquer
   outra decisão (`rejected`, ambiguity fallback) é preservada — só
   `ACCEPTED` é rebaixado.
3. **`outside_region`** (`distance > radius_m + 500`) — o item fica
   **excluído da elegibilidade para publicação na região corrente**:
   não entra na fila normal de Human Review, não pode ser promovido nem
   publicado sob este `region_key`. **O dado continua a existir e a
   ser persistido** — em `venues_staging`, com
   `proposal_status = 'geographic_excluded'`, distinto de
   `pending_review`/`promoted`/`rejected`. Não é uma afirmação sobre a
   existência do dado; é uma afirmação sobre a sua elegibilidade para
   publicação nesta região, nesta ingestão.

`raw_venue_items` (Camada A) nunca é afectado pelo gate — a evidência
bruta de todo resultado colhido é sempre gravada antes deste ponto.
`venues_staging` (Camada B), a partir desta revisão, **também nunca
perde nenhum item por causa do gate** — a única coisa que muda é o
`proposal_status`, nunca a existência do registo.

### Genérico por desenho

- O gate opera apenas sobre `lat/lng` do item (já devolvido pelo Google,
  zero chamadas extra) e `lat/lng/radius_m` da região que gerou a query
  (`source_region_label` → config da região) — nenhuma condição
  específica de bairro, cidade ou produto.
- `radius_m` é sempre o valor já configurado por região — o gate nunca
  usa um raio fixo. Testado explicitamente com Cabo Frio (12.000m) e
  Brooklin (2.500m) no mesmo conjunto de testes.
- A margem de buffer (500m) é uma constante de classificação
  (`BUFFER_METERS`), não um segundo raio de busca nem algo configurável
  por região nesta versão.
- `SourceConfigContract.regions` é um campo **aditivo e opcional** — o
  gate só é aplicado quando a fonte declara regiões (Google Places);
  fontes sem geolocalização (WordPress) seguem sem qualquer alteração
  de comportamento.
- A regra pré-existente "nunca persistir `rejected` (decisão de tipo)
  em `venues_staging`" **não foi alterada** por esta ADR — continua a
  aplicar-se exactamente como antes. `geographic_excluded` é um eixo
  ortogonal (elegibilidade regional), não uma substituição desse eixo
  (decisão de curadoria por tipo). Um item pode, simultaneamente, ter
  sido `rejected` pelo tipo E estar `outside_region` — nesse caso, a
  regra mais antiga prevalece (continua fora de `venues_staging`,
  presente só em `raw_venue_items`) porque nenhuma decisão de tipo
  mudou nesta ADR.

## Justificação

- A alternativa de ajustar `radius_m` foi descartada com evidência: o
  problema não é o raio estar mal calibrado — reduzi-lo não impediria
  marcos a 8-10km de aparecer, e aumentá-lo pioraria a sobreposição
  geográfica genuína sem resolver a fuga.
- A alternativa de adicionar regras de rejeição por tipo (ex:
  `reject_type_residential`) resolve um problema diferente — não a
  fuga geográfica, que acontece precisamente com tipos que a plataforma
  **quer** aceitar (`museum`, `performing_arts_theater`).
- **Excluir `outside_region` do array antes de `venues_staging` foi
  tentado primeiro e revertido.** Justificação da reversão: se amanhã
  alguém perguntar "por que o Museu Catavento nunca apareceu?", a
  resposta não pode ser "porque foi descartado sem deixar rasto" — tem
  de ser rastreável, auditável e, no limite, reclassificável (ex: se o
  raio de uma região for revisto no futuro, um item hoje
  `geographic_excluded` pode voltar a ser avaliado sem precisar de nova
  ingestão).
- `outside_region` não entra na fila normal de Human Review (ao
  contrário de `buffer_zone`) porque a distância aqui é grande o
  suficiente (>3km) para não haver ambiguidade genuína a resolver — um
  humano não precisa de decidir se o MASP é "do Brooklin". Reservar
  Human Review para casos genuinamente ambíguos (a margem do buffer)
  evita desperdiçar o tempo do curador, sem sacrificar a
  rastreabilidade do dado.

## Consequências

- Toda futura região herda este gate automaticamente, sem nenhuma
  configuração adicional além de já ter `regions` com `radius_m`
  definido (obrigatório desde a ADR-0021).
- `IngestionSummary.geoExcludedItems` regista quantos itens desta run
  ficaram `geographic_excluded` — persistidos, não descartados.
- `VenueStagingRepository.insertBatch()` foi alterado (não apenas
  estendido) para deixar de gravar `proposal_status = 'pending_review'`
  incondicionalmente e passar a derivá-lo do metadado geográfico quando
  presente. **Pendência a confirmar antes da primeira ingestão real
  pós-ADR-0022:** não há confirmação de que a coluna
  `venues_staging.proposal_status` aceite o novo valor
  `'geographic_excluded'` sem uma migration — se existir uma constraint
  `CHECK` restringindo os valores aceites (comum nesta base de código,
  ex: migrations anteriores de `public.venues.engine_status`), a
  primeira tentativa de inserir esse valor falhará em runtime. Confirmar
  com:
  ```sql
  SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'staging.venues_staging'::regclass AND contype = 'c';
  ```
  Se existir uma constraint que não inclua `'geographic_excluded'`, é
  necessária uma migration antes de qualquer ingestão real — não deve
  ser aplicada sem essa confirmação.
- `reject_type_residential` (ruído de `parque` com nomes de condomínios,
  identificado na mesma validação) permanece **fora de escopo desta
  ADR** — é um problema de precisão de tipo, não de geografia.
- Esta ADR não altera `00-filter-venue` nem `GooglePlacesCollector` —
  o Venue Filtering Engine continua a decidir por tipo/keyword sem saber
  que o gate geográfico existe; a composição dos dois é responsabilidade
  do `IngestionOrchestrator`.

## Snapshot local (dry-run) — cache operacional, não fonte de verdade

O script `dry-run-google-places.ts` grava, a cada execução, um snapshot
local (`dry-run-snapshots/<produto>_<region_key>_<timestamp>.json`) com
`place_id, nome, lat/lng, categoria, google_types, decisão, reasoning,
distância, bucket` de cada resultado. **Isto é explicitamente um cache
operacional**, para permitir comparar raios diferentes ou testar novas
regras sem repetir uma chamada paga — **nunca é a fonte de verdade**.
A fonte de verdade continua a ser `raw_venue_items` (e, na ingestão
real, `venues_staging`). O snapshot pode ser apagado a qualquer momento
sem perda de informação oficial, e nenhum script de ingestão real o lê
automaticamente.

## Testes

`src/pipeline/stages/01-geographic-gate/__tests__/applyGeographicGate.test.ts`
— 22 testes, incluindo:

- Os três limites exactos da política: `distance === radius_m` exacto
  → `inside_radius`; `distance === radius_m + 500` exacto →
  `buffer_zone`; `radius_m + 501` → `outside_region`.
- **Confirmação explícita de que o gate nunca remove itens do array** —
  o número de itens devolvidos é sempre igual ao número recebido,
  incluindo casos `outside_region` combinados com `rejected` de tipo.
- Preservação de decisões não-`ACCEPTED` no buffer, ausência de mutação
  do item original, comportamento defensivo quando a região não é
  encontrada, e generalização comprovada com múltiplos `radius_m`
  (2.500m e 12.000m).

`src/persistence/repositories/__tests__/repositories.test.ts` —
2 testes novos confirmando que `VenueStagingRepository.insertBatch()`
persiste itens `outside_region` (nunca os descarta) com
`proposal_status = 'geographic_excluded'`, e que itens
`inside_radius`/`buffer_zone` continuam `pending_review` mesmo com
metadado geográfico anexado.
