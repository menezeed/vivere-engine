# ADR-0008 — Encerramento da Fase 4: Ingestão Completa Validada em Produção

**Status:** Aceito
**Data:** 2026-07-03
**Decisores:** Eduardo Menezes

---

## Contexto

A Fase 4 tinha como objetivo executar a primeira ingestão completa (sem `--limit`)
da Vivere Engine em banco real, validando o pipeline end-to-end com dados reais
de múltiplas cidades e múltiplas fontes.

A Fase 3 havia validado a persistência com `--limit=2` (2 queries, ~23 venues).
A Fase 4 expande isso para o escopo completo do produto Vivere 60+.

---

## Decisões tomadas durante a Fase 4

### Escopo geográfico: Cabo Frio + São Pedro da Aldeia + Iguaba Grande

Araruama foi considerada e removida em favor de São Pedro da Aldeia, que forma
um cluster geográfico mais coeso com Cabo Frio e Iguaba Grande (Região dos Lagos
leste). Araruama fica como expansão futura.

Raios configurados por cidade:
- Cabo Frio: 12km (maior área urbana, distritos como Tamoios incluídos)
- São Pedro da Aldeia: 10km
- Iguaba Grande: 8km (menor cidade do cluster)

### Config de produto como única superfície de mudança

A adição de uma nova cidade (São Pedro da Aldeia) e a remoção de outra (Araruama)
exigiu alteração de apenas um arquivo: `src/collectors/google-places/config/vivere-60-mais.ts`.
Nenhuma linha do motor foi tocada — validação concreta da tese de plataforma (ADR-0004).

### Erros de parsing no WordPress Collector são aceitáveis

A run da Prefeitura de Cabo Frio registrou `items_errored: 9` com `items_collected: 8`
e `status: success`. Os erros representam posts que não puderam ser parseados
(ambiguidade de data, bloco estruturado ausente) — comportamento esperado e
documentado (ADR-0003: nunca inventar, ambiguidade vai para descarte ou revisão).
A run fecha como `success` porque o Orchestrator considera erros de parsing como
erros de item, não falhas de execução.

---

## Critérios de aceite — todos validados em banco real

| Critério | Evidência |
|---|---|
| Google Places Collector — 3 cidades | 21 queries executadas, 163 venues coletados, USD 3,48 |
| WordPress Content Collector validado | 8 atividades coletadas e persistidas |
| Camada A persistindo corretamente | 208 raw_venue_items + 8 raw_activity_items |
| Camada B com proposal_status=pending_review | 160 venues_staging + 8 activities_staging |
| IngestionRun ciclo completo | 4 runs com status=success |
| Idempotência cross-run | UNIQUE(source_key, source_item_id, product_key) — zero duplicatas |
| Proveniência preservada via FK | raw_venue_item_id em cada linha de staging |
| Append-only protegido por RLS | UPDATE em raw_* retorna 0 rows |
| RepositoryFactory generalizada | forSupabase(), forSupabaseWith(), fromObject() |
| Collector Contracts desacoplados | Orchestrator depende de VenueCollectorContract, não de GooglePlacesCollector |

---

## Estado do banco ao encerramento da Fase 4

| Tabela | Registros |
|---|---|
| staging.raw_venue_items | 208 |
| staging.venues_staging | 160 |
| staging.raw_activity_items | 8 |
| staging.activities_staging | 8 |
| staging.ingestion_runs | 4 |

IngestionRun IDs relevantes:
- `02735e08` — Google Places, 3 cidades, 163 venues, 2026-07-03
- `e25dd16e` — WordPress Cabo Frio, 8 atividades, 2026-07-03

---

## O que NÃO foi implementado nesta fase (escopo intencional)

- Human Review Engine (painel de curadoria)
- Entity Resolution
- Promotion Engine
- WordPress instances para São Pedro da Aldeia e Iguaba Grande
- Scheduler automático

Estes itens são escopo da Fase 5 em diante.

---

## Próximo passo: Fase 5 — Human Review Engine

Com 160 venues e 8 atividades em `pending_review`, o banco tem volume suficiente
para começar a Human Review Engine. O objetivo da Fase 5 é construir o mecanismo
que permite a um revisor humano aprovar, rejeitar ou editar itens em staging,
e eventualmente promovê-los para as tabelas operacionais do app.
