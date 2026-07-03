# CHANGELOG — Vivere Engine

Todas as mudanças significativas são documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [v4.0] — 2026-07-03 — Fase 4: Ingestão Completa

### Adicionado
- Ingestão completa Google Places sem `--limit` — 3 cidades, 21 queries, 163 venues
- São Pedro da Aldeia como terceira cidade do cluster (substituindo Araruama)
- Ingestão WordPress / Prefeitura de Cabo Frio — 8 atividades persistidas
- 208 `raw_venue_items` + 8 `raw_activity_items` em banco real
- 160 `venues_staging` + 8 `activities_staging` com `proposal_status=pending_review`
- ADR-0008 registrando o encerramento formal da Fase 4

### Validado em produção
- IngestionOrchestrator com 4 runs completas (status=success)
- Idempotência cross-run via `UNIQUE(source_key, source_item_id, product_key)`
- Append-only protegido por RLS nas tabelas `raw_*`
- Proveniência via FK em toda a cadeia (raw → staging)
- RepositoryFactory desacoplada da tecnologia de persistência
- Collector Contracts abstratos (Orchestrator nunca importa classes concretas)

### Configuração
- Raios geográficos: Cabo Frio 12km, São Pedro da Aldeia 10km, Iguaba Grande 8km
- Custo por execução completa: USD 3,48 (dentro do limite de USD 10/mês)

---

## [v3.0] — 2026-07-02 — Fase 3: Persistência Real

### Adicionado
- Camada de persistência completa (5 repositórios + IngestionOrchestrator)
- `RepositoryFactory` com `forSupabase()`, `forSupabaseWith()`, `fromObject()`
- Contratos abstratos de Collector (`VenueCollectorContract`, `ActivityCollectorContract`, `SourceConfigContract`)
- Scripts `ingest-google-places.ts` e `ingest-wordpress-content.ts`
- Migration `0003` — `UNIQUE(raw_venue_item_id)` em staging
- Migration `0004` — `UNIQUE(source_key, source_item_id, product_key)` — idempotência cross-run
- ADR-0007 registrando o encerramento formal da Fase 3
- Architecture Book v1.1

### Corrigido
- `RepositoryFactory.forSupabase()` usando `await import()` em vez de `require()` (ESM)
- Constraint de idempotência cross-run em `venues_staging` (bug descoberto em validação real)
- Permissões RLS e `service_role` legacy key para acesso ao schema `staging`

### Validado em produção
- Primeira ingestão real: 23 venues, 22 staged, 1 rejected, 0 erros
- Idempotência: segunda execução → zero duplicatas

---

## [v2.0] — 2026-06 — Fase 2: Generalização

### Adicionado
- Plataforma Vivere multi-produto com `product_key` (ADR-0004)
- `GooglePlacesCollector` generalizado para qualquer produto
- `WordPressContentCollector` generalizado com configuração por instância
- `Venue Filtering Engine` generalizado com defaults universais + config por produto (ADR-0005)
- `VenueFilterRuleSet<TRuleId, TAmbiguityLabel>` — generics duplos para isolamento entre produtos
- Produto sintético de turismo para prova de isolamento
- Configuração Vivere 60+ em Cabo Frio e Araruama (dry-run validado)
- `BudgetGuard` com `hard_stop_enabled` e `alert_threshold_pct`
- ADR-0004 e ADR-0005

### Renomeado
- Plataforma: Vida Ativa 60+ → Vivere / Vivere 60+
- Repositório: vaip-engine → vivere-engine
- `product_key`: `vida-ativa-60-mais` → `vivere-60-mais`

---

## [v1.0] — 2026-06 — Fase 1: Fundação

### Adicionado
- `GooglePlacesCollector` — coleta de venues via Google Places API Text Search
- `WordPressContentCollector` com extrator de duas camadas (estruturado + narrativo)
- `Venue Filtering Engine` (estágio 00 do pipeline)
- Contratos `RawVenueItem` e `RawActivityItem` com `VenueMention`
- `sourcePriority.ts` — tabela de prioridade de fontes
- Migrations `0001` e `0002` — schema base + RLS append-only
- Scripts de dry-run para Google Places e WordPress
- ADR-0001, ADR-0002, ADR-0003, ADR-0006
- 121 testes unitários (Vitest)
