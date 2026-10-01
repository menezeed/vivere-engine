# Collectors

## Princípio
Collectors conhecem tecnologias, não cidades nem produtos.

## Google Places Collector
Configuração:
- cidades
- categorias
- product_key

## WordPress Content Collector
Configuração:
- URL
- categoria
- marcadores
- cidade
- product_key

## Contrato
Todo Collector retorna apenas:
- RawActivityItem
ou
- RawVenueItem

---

## Fontes de Activity Discovery V1 — matriz de validação

**Acrescentado em 2026-10-01 (Activity 14/26, Fase 14B).** Esta secção
distingue fontes de **Activity Discovery** (o foco desta matriz) de
componentes de **Venue Discovery**, que seguem um caminho de código
diferente e não estão cobertos aqui.

### `prefeitura_cabo_frio`

- **Implementada:** sim — `WordPressContentCollector`, config
  `cabo-frio.ts`
- **Validada com dados reais de Activity:** sim — em uso desde Activity 8
- **Auditada:** parcialmente (Activity 11) — achados F1 (falha de
  extracção estruturada em título "Hora:"), F2 (gramática de lista com
  travessão não suportada), F3 (hipótese de categoria, não quantificada)

### São Pedro da Aldeia (`sao-pedro-da-aldeia` / `sao_pedro_da_aldeia`)

- **Implementada:** sim — `WordPressContentCollector`, config
  `sao-pedro-da-aldeia.ts`
- **Validada com dados reais de Activity:** sim — 160 posts reais,
  Activity 13
- **Auditada:** sim — auditoria completa (F5–F10, Activity 13); ver
  baseline em `regional-baselines/` e ADR de Discovery V1 Freeze
- **Limitações conhecidas:** F4 (categoria 49 + 30 dias → 0 posts
  elegíveis, Activity 12); ver também as limitações de recorrência
  documentadas no ADR de Discovery V1 Freeze

### `google_places`

- **Implementada:** sim — `GooglePlacesCollector`
- **Validada com dados reais:** sim, **para Venues** — não é uma fonte de
  Activity Discovery. O Google Places Collector produz `RawVenueItem`,
  nunca `RawActivityItem`. Não deve ser citado como evidência de que
  Activity Discovery V1 suporta actividades vindas do Google Places.

### `prefeitura_iguaba_grande`

- **Implementada:** NÃO confirmada no código actual — nenhuma config de
  `iguaba-grande` existe em `ingest-wordpress-content.ts`
- **Validada com dados reais:** NÃO
- **Classificação:** EXPERIMENTAL / LEGACY / UNTRUSTED
- **Incidente de proveniência (preservado, não reescrito):** 14 registos
  com `source_key = 'prefeitura_iguaba_grande'` em `activities_staging`
  foram investigados em 2026-09-20 e classificados como
  **provenance inconsistent / origin unknown / excluded from evidence**
  — nenhum caminho de código conhecido do Engine pode tê-los produzido
  (`mapToRawActivityItems.ts` tem `source_key` fixo em
  `'prefeitura_cabo_frio'`; os 14 registos partilham um
  `ingestion_run_id` de uma coleta real de `google_places` em Santo
  Amaro, sem nenhuma relação com Iguaba Grande). Detalhe completo em
  `docs/regional-baselines/activity-engine-discovery-1.2.md`, secção
  "Excluded Evidence". Estes registos nunca devem ser citados como
  evidência de Discovery, parsing ou decisão arquitectural.

### `sympla_api`

- **Implementada:** referenciada como `ActivityCollectorContract` de
  exemplo em testes (`IngestionOrchestrator.test.ts`)
- **Validada com dados reais:** NÃO — nunca observada fora de fixtures de
  teste
- **Classificação:** test/example only
