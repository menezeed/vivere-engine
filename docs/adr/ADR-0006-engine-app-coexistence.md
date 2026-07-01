# ADR-0006 — Coexistência entre Vivere Engine e o schema operacional do aplicativo

**Status:** Aceito
**Data:** 2026-06-30
**Decisores:** Eduardo Menezes

---

## Contexto

Durante a Fase 3 da Vivere Engine, ao preparar a primeira migration de banco de dados (`0001_phase3_domain_model.sql`), a query de colisão pré-execução revelou que o banco dev já contém um schema operacional consolidado com dados reais:

| Tabela | Registros |
|---|---|
| `public.venues` | 11 |
| `public.activities` | 21 |
| `public.favorites` | 2 |
| `public.partners` | 3 |
| `public.activity_interests` | 7 |
| `public.suggestions` | 4 |
| `public.categories` | 9 |

Esse schema foi construído independentemente da modelagem de domínio conduzida na Fase 3 da engine. Suas tabelas refletem o modelo de dados operacional do aplicativo Vivere 60+ tal como ele existe hoje em produção/dev, com estrutura distinta do modelo conceitual desenhado para a engine (ex: `public.activities` do app tem `category` texto livre, `schedule` texto, `is_sponsored`; o modelo da engine usa `venue_resolution_status`, `product_key`, referências à Camada A).

Havia três caminhos possíveis:
- **Caminho A:** Coexistência — a engine usa schemas e tabelas próprias, sem tocar no schema do app
- **Caminho B:** Substituição planejada — migrar o schema atual do app para o modelo da engine
- **Caminho C:** Banco dev separado — criar um projeto Supabase separado para a engine

## Decisão

**Caminho A foi escolhido.**

A Vivere Engine coexiste com o schema operacional do aplicativo usando exclusivamente:
- Schema `staging.*` (integralmente novo, sem colisão)
- `public.products` (novo, sem colisão)
- `public.sources` (novo, sem colisão)

As tabelas `public.venues`, `public.activities` e todas as demais tabelas operacionais do app (`favorites`, `partners`, `activity_interests`, `suggestions`, `categories`) **não são tocadas, renomeadas, alteradas ou removidas** por qualquer migration da engine.

As tabelas do modelo conceitual da engine que dependiam de `public.venues` e `public.activities` próprias da engine foram adiadas:
- `public.venue_contributions` (FK → public.venues da engine)
- `public.activity_source_links` (FK → public.activities da engine)

Os campos `promoted_venue_id` e `promoted_activity_id` nas tabelas de staging foram mantidos como `uuid nullable` sem FK — prontos para receber a referência quando o Caminho B for executado no futuro.

## Consequências

**Imediatas (positivas):**
- Zero risco ao banco atual do aplicativo em produção/dev
- A Vivere Engine pode evoluir de forma completamente independente
- Compatibilidade com o aplicativo existente é preservada sem nenhum trabalho adicional
- A migration `0001_phase3_domain_model.sql` pôde ser aplicada sem bloqueio

**A aceitar (trade-offs):**
- A integração entre os dados coletados pela engine (em `staging.*`) e as entidades do app (`public.activities`, `public.venues`) não existe ainda — dados promovidos pela engine não aparecem automaticamente no app
- Duas tabelas do modelo conceitual aprovado (`venue_contributions`, `activity_source_links`) ficam adiadas, criando uma lacuna temporária na Camada C
- Os campos `promoted_venue_id`/`promoted_activity_id` em staging ficam sem FK, o que o banco não pode validar automaticamente enquanto o Caminho B não acontecer

**Trabalho futuro criado (migration de convergência):**

Quando houver clareza sobre o modelo definitivo do aplicativo, uma migration específica de convergência precisará:
1. Decidir se `public.venues` e `public.activities` do app são migradas para o modelo da engine (rename + transform) ou se novas tabelas são criadas com nomes distintos
2. Criar `public.venue_contributions` com FK real para a entidade Venue da engine
3. Criar `public.activity_source_links` com FK real para a entidade Activity da engine
4. Adicionar as FKs de promoção (`promoted_venue_id`, `promoted_activity_id`) nos registros de staging via `ALTER TABLE`
5. Tratar os 11 venues e 21 atividades existentes no app — decidir se são importados como `RawVenueItem`/`RawActivityItem` retroativamente, ou tratados como registros legados sem proveniência rastreada pela engine

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `db/migrations/0001_phase3_domain_model.sql` | Adaptado: remove `public.venues`, `public.activities`, `venue_contributions`, `activity_source_links`; mantém 7 tabelas seguras |
| `db/migrations/0001_phase3_domain_model.rollback.sql` | Atualizado para as 7 tabelas da versão adaptada |
| `db/migrations/0001_PRE_EXECUTION_CHECKLIST.md` | Revisado para refletir o diagnóstico de colisão e a decisão do Caminho A |

## Relação com outros ADRs e documentos

- **ARCHITECTURE_EVOLUTION.md** — registra a evolução da modelagem de domínio que levou ao desenho das Camadas A, B e C; esta decisão cria uma divergência temporária entre o modelo conceitual e o modelo físico implementado
- **ADR implícito: schema compartilhado com `product_key`** (registrado em conversas de modelagem de domínio) — permanece válido para as tabelas da engine; não se aplica às tabelas do app existente, que não usa `product_key`
