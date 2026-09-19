# ADR-0022 — Regional Geographic Gate

**Status:** Aceito
**Data:** 2026-07-15 (revista em 2026-07-15, pós-revisão arquitectural; revista de novo em 2026-09-19, Level 2 review do PR #1 — ver "Correcção" abaixo)

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

**Revisão desta ADR (mesmo dia, 2026-07-15):** a primeira versão
implementada excluía itens `outside_region` do array antes de
`venues_staging`, nunca chegando lá. Revisão arquitectural apontou que
isto contraria o princípio de "nunca perder evidência" já consolidado
na Fase 8 (ex: ADR-0016 — venues são arquivados, nunca apagados).
Corrigido nesse momento: ver Decisão.

## Correcção (2026-09-19, Level 2 review do PR #1)

A versão desta ADR aprovada em 2026-07-15 ainda descrevia
`outside_region` como `proposal_status = 'geographic_excluded'` — um
único valor sobrecarregado na coluna de curadoria. Essa mesma versão já
antecipava, na secção "Consequências", uma pendência não confirmada:
se a coluna `proposal_status` tivesse uma constraint `CHECK` que não
incluísse `'geographic_excluded'`, a primeira inserção real falharia em
runtime.

**Essa pendência materializou-se como um incidente real de produção**:
a constraint existia, a inserção falhou. A correcção implementada, e é
esta a decisão final e correcta, **substitui o modelo de valor único
sobrecarregado por dois eixos independentes**:

- `proposal_status` — exclusivamente sobre **curadoria humana**
  (`pending_review` / `approved` / `rejected` / `promoted`). Nunca
  contém `'geographic_excluded'`.
- `geographic_status` — coluna própria, independente, sobre
  **elegibilidade geográfica** (`inside_radius` / `buffer_zone` /
  `outside_region` / `NULL`).

Um item `outside_region` continua **visível em Human Review**, com
indicação clara do seu estado geográfico (não fica escondido nem
excluído da fila) — o revisor decide conscientemente. A barreira
efectiva contra publicação indevida de itens `outside_region` está na
**Publishing Engine** (`PublishableVenueRepository`/
`PublishableActivityRepository`), que filtra explicitamente por
`geographic_status` antes de qualquer publicação — não na exclusão da
fila de Human Review.

**Nota sobre a origem da coluna `geographic_status`:** referências
anteriores a uma "migration 0018" como responsável por introduzir esta
coluna não foram confirmadas por leitura directa do ficheiro de
migration correspondente nem por histórico de commits verificável. Não
afirmar isso como facto até essa confirmação existir. A coluna existe e
funciona em produção — isso está confirmado operacionalmente — mas a
sua proveniência exacta em `db/migrations/` permanece uma pendência de
schema-as-code a esclarecer separadamente, sem bloquear esta correcção
de documentação.

O resto desta ADR (Contexto, Justificação, secções abaixo) mantém-se
válido tal como escrito em 2026-07-15 — só a forma de persistir
`outside_region` mudou, não o resto da política de classificação por
distância.

## Decisão

Um novo estágio de pipeline, **Regional Geographic Gate**
(`src/pipeline/stages/01-geographic-gate`), aplicado **depois** do
Venue Filtering Engine e **antes** da persistência em
`venues_staging`:

```
RawVenueItem[] → raw_venue_items (sempre, Camada A)
              → 00-filter-venue (decisão por tipo/keyword)
              → 01-geographic-gate (esta ADR — nunca remove itens)
              → venues_staging (TODOS os itens, com geographic_status ajustado)
```

### Política

1. **`inside_radius`** (`distance <= radius_m`) — decisão do Venue
   Filtering Engine preservada sem alteração. `geographic_status =
   'inside_radius'`.
2. **`buffer_zone`** (`radius_m < distance <= radius_m + 500`) — se a
   decisão efectiva for `ACCEPTED`, é **forçada para `NEEDS_REVIEW`**,
   com a tag `geographic_buffer_zone` anexada à `reasoning`. Qualquer
   outra decisão (`rejected`, ambiguity fallback) é preservada — só
   `ACCEPTED` é rebaixado. `geographic_status = 'buffer_zone'`.
3. **`outside_region`** (`distance > radius_m + 500`) — o item fica
   **excluído da elegibilidade para publicação na região corrente**
   (aplicado pela Publishing Engine, não pela ausência do item em
   `venues_staging`, nem pela sua ausência da fila de Human Review).
   **O dado continua a existir e a ser persistido** — em
   `venues_staging`, com `geographic_status = 'outside_region'`,
   `proposal_status` inalterado por esta classificação (continua
   `pending_review`, exactamente como qualquer outro item recém-
   -persistido, sujeito ao mesmo fluxo normal de curadoria). Não é uma
   afirmação sobre a existência do dado; é uma afirmação sobre a sua
   elegibilidade para publicação nesta região, nesta ingestão —
   registada num eixo (`geographic_status`) inteiramente separado do
   eixo de curadoria (`proposal_status`).

`raw_venue_items` (Camada A) nunca é afectado pelo gate — a evidência
bruta de todo resultado colhido é sempre gravada antes deste ponto.
`venues_staging` (Camada B) também nunca perde nenhum item por causa do
gate — a única coisa que muda é `geographic_status`, nunca a existência
do registo, e `proposal_status` só muda através do fluxo normal de
Human Review (approve/reject/promote), nunca como efeito colateral da
classificação geográfica.

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
  aplicar-se exactamente como antes. `geographic_status` é um eixo
  ortogonal (elegibilidade regional), não uma substituição desse eixo
  (decisão de curadoria por tipo, reflectida em `proposal_status`). Um
  item pode, simultaneamente, ter sido `rejected` pelo tipo E estar
  `outside_region` — nesse caso, a regra mais antiga prevalece (continua
  fora de `venues_staging`, presente só em `raw_venue_items`) porque
  nenhuma decisão de tipo mudou nesta ADR.

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
  `outside_region` pode voltar a ser avaliado sem precisar de nova
  ingestão).
- **Sobrecarregar `proposal_status` com um valor adicional
  (`geographic_excluded`) também foi tentado primeiro e revertido** —
  ver "Correcção" acima. Dois eixos independentes (`proposal_status`
  para curadoria, `geographic_status` para elegibilidade geográfica)
  evitam colidir com constraints existentes na coluna de curadoria, e
  mantêm as duas dimensões (o que um humano decidiu vs. onde o item
  está geograficamente) claramente separáveis em qualquer query.
- `outside_region` continua visível em Human Review (ao contrário de um
  modelo que o excluísse da fila) porque a rastreabilidade e a
  possibilidade de revisão humana consciente têm mais valor do que
  poupar tempo de curadoria escondendo o item — a barreira real contra
  publicação indevida está na Publishing Engine, não na visibilidade em
  Human Review.

## Consequências

- Toda futura região herda este gate automaticamente, sem nenhuma
  configuração adicional além de já ter `regions` com `radius_m`
  definido (obrigatório desde a ADR-0021).
- `IngestionSummary.geoExcludedItems` regista quantos itens desta run
  ficaram `outside_region` — persistidos, não descartados.
- A Publishing Engine (`PublishableVenueRepository`,
  `PublishableActivityRepository`) filtra explicitamente por
  `geographic_status <> 'outside_region'` (ou `NULL`) antes de
  qualquer publicação — esta é a defesa em profundidade real contra
  publicação indevida, não a ausência do item em `venues_staging` nem
  a sua exclusão de Human Review.
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
testes confirmando que `VenueStagingRepository.insertBatch()` persiste
itens `outside_region` (nunca os descarta), gravando
`geographic_status = 'outside_region'` numa coluna própria, com
`proposal_status` inalterado (continua `pending_review`, sujeito ao
fluxo normal de curadoria); itens `inside_radius`/`buffer_zone` seguem
o mesmo padrão, cada um com o `geographic_status` correspondente.
