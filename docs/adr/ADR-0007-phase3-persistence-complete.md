# ADR-0007 — Encerramento da Fase 3: Persistência Real da Vivere Engine

**Status:** Aceito
**Data:** 2026-07-03
**Decisores:** Eduardo Menezes

---

## Contexto

A Fase 3 tinha como objetivo único e explícito transformar a Vivere Engine de um
sistema de dry-run em um sistema que persiste dados reais em banco. Nenhuma nova
funcionalidade de produto foi escopo desta fase — apenas a camada de persistência,
com todos os princípios arquiteturais já aprovados preservados.

O marco de encerramento foi definido como: primeira ingestão real validada em banco,
com idempotência comprovada em múltiplas execuções consecutivas.

---

## Decisões tomadas durante a Fase 3

### Repository Pattern com interfaces

Todos os repositórios dependem de interfaces (`IIngestionRunRepository`,
`IRawVenueItemRepository`, etc.), não de classes concretas. O `IngestionOrchestrator`
nunca importa `GooglePlacesCollector` nem `WordPressContentCollector` — depende apenas
de `VenueCollectorContract` e `ActivityCollectorContract`. Isso permite substituir
qualquer implementação (Supabase, mock, SQLite) sem alterar o Orchestrator.

### RepositoryFactory com três métodos estáticos

`forSupabase()` para produção, `forSupabaseWith(overrides)` para testes de integração
parciais, `fromObject(repos)` para testes unitários com mocks completos. A factory
usa `await import()` (ESM) em vez de `require()` para carregar o cliente Supabase
apenas quando necessário — não em tempo de importação do módulo.

### Idempotência em duas camadas

**Camada A (`raw_venue_items`):** `UNIQUE(source_key, source_item_id, ingestion_run_id)` +
`ON CONFLICT DO NOTHING`. Cada run registra o que a fonte retornou naquele momento —
múltiplas runs geram múltiplas linhas para o mesmo venue (dado bruto histórico por run).

**Camada B (`venues_staging`):** `UNIQUE(source_key, source_item_id, product_key)` +
`ON CONFLICT DO NOTHING`. O mesmo venue de uma fonte nunca entra duas vezes em staging
para o mesmo produto, independente de quantas runs rodarem. Esta constraint foi
adicionada pela migration 0004 após descoberta em validação real — a constraint original
`UNIQUE(raw_venue_item_id)` era por run, não cross-run.

### Append-only via RLS

Tabelas `raw_*` protegidas por Row-Level Security com `using(false)` para UPDATE e
DELETE. Validado em ambiente real: UPDATE em `raw_venue_items` retorna 0 rows afetadas.

### Separação entre dry-run e ingestão real

Scripts `dry-run-*.ts` preservados intactos — nunca chamam repositórios. Scripts
`ingest-*.ts` criados separadamente para ingestão real. O Orchestrator suporta
`dryRun: true` como flag que executa coleta e filtragem mas não persiste nada.

### Coexistência com schema do app (ADR-0006 confirmado em prática)

A engine escreveu dados reais em `staging.*` e `public.products`/`public.sources`
sem tocar em `public.venues`, `public.activities`, `favorites`, `activity_interests`,
`suggestions`, `partners` ou `categories` do app existente. O isolamento de schema
funcionou exatamente como desenhado.

---

## Critérios de aceite — todos validados em ambiente real

| Critério | Evidência |
|---|---|
| IngestionRun ciclo completo (running → success/failed) | Run `82e42276` e `61b6d2f7` registradas com status success |
| Camada A persiste corretamente | 23 venues em `raw_venue_items`, raw_payload íntegro |
| Venue Filtering Engine integrado | 1 rejected, 22 staged — motor funcionando end-to-end |
| Camada B persiste com proposal_status=pending_review | 22 linhas em `venues_staging`, todas pending_review |
| Proveniência preservada via FK | `raw_venue_item_id` presente em cada linha de staging |
| Append-only protegido por RLS | UPDATE retornou 0 rows |
| Idempotência cross-run comprovada | Segunda execução: `venues_staging inserted: 2` (apenas novos), zero duplicatas confirmado por query GROUP BY |
| Nenhuma tabela do app alterada | `public.venues`, `public.activities` e demais tabelas do app intactas |

---

## Migrations aplicadas (sequência completa)

| Migration | Descrição |
|---|---|
| `0001_phase3_domain_model.sql` | Schema base — 7 tabelas (Camada A + B + configuração) |
| `0002_raw_tables_append_only.sql` | RLS append-only nas tabelas raw_* |
| `0003_staging_idempotency_constraints.sql` | UNIQUE(raw_venue_item_id) em staging (substituída pela 0004) |
| `0004_venues_staging_source_dedup.sql` | UNIQUE(source_key, source_item_id, product_key) — idempotência cross-run real |

---

## O que NÃO foi implementado nesta fase (escopo intencional)

- Entity Resolution
- Promotion Engine
- Human Review
- Ingestão de atividades WordPress (validada apenas em dry-run)
- Scheduler / execução automática
- Ingestão completa sem `--limit` (validada com `--limit=2`)

Estes itens são escopo da Fase 4.

---

## Ambiente de execução

O banco utilizado é o projeto `vida-ativa-60` (Supabase, AWS eu-west-1), que também
contém o schema operacional do app. A coexistência foi validada na prática sem
nenhum impacto nas tabelas do app — confirmando o ADR-0006 em ambiente real,
não apenas em análise teórica.

Um projeto Supabase dedicado para dev (`vivere-engine-dev`) está pendente de criação
quando o limite de projetos gratuitos for resolvido. A ingestão de Fase 4 deve
preferencialmente rodar nesse projeto separado.
