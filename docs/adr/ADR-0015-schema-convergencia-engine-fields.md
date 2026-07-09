# ADR-0015 — Schema de Convergência: Engine Fields em public.venues e public.activities

**Status:** Aceito
**Data:** 2026-07-08
**Decisores:** Eduardo Menezes
**Depende de:** ADR-0006 (Caminho A), ADR-0019 (Operational Model)

---

## Contexto

O ADR-0006 escolheu o Caminho A (coexistência): a engine usa staging.*,
sem tocar em public.venues e public.activities. Com o Publishing Engine (Fase 8),
é necessário dar o primeiro passo do Caminho B: adicionar campos da engine
às tabelas públicas existentes, sem alterar nem apagar nenhum campo original.

A Sprint 8.0 (Schema Discovery) revelou o schema real:
- `public.venues`: 11 colunas, sem constraints além da PK, 11 registos legacy (UK pilot)
- `public.activities`: 19 colunas, FK venue_id → venues.id, 21 registos legacy (UK pilot)
- Sem triggers, sem views dependentes, sem índices adicionais

---

## Decisão

Adicionar 5 campos de engine a `public.venues` e 5 campos a `public.activities`
via migrations 0012 e 0013. Nenhum campo existente é alterado ou removido.

### Campos adicionados a public.venues (migration 0012)

| Campo | Tipo | Default | Significado |
|---|---|---|---|
| `engine_venue_id` | UUID UNIQUE | NULL | FK para staging.venues_staging.id |
| `source_key` | TEXT NOT NULL | 'legacy' | Rastreabilidade de fonte |
| `product_key` | TEXT NOT NULL | 'legacy' | Dimensão de produto |
| `engine_status` | TEXT NOT NULL | 'active' | Estado no Operational Model |
| `last_published_at` | TIMESTAMPTZ | NULL | Timestamp da última publicação |

### Campos adicionados a public.activities (migration 0013)

| Campo | Tipo | Default | Significado |
|---|---|---|---|
| `engine_activity_id` | UUID UNIQUE | NULL | FK para staging.activities_staging.id |
| `source_key` | TEXT NOT NULL | 'legacy' | Rastreabilidade de fonte |
| `product_key` | TEXT NOT NULL | 'legacy' | Dimensão de produto |
| `engine_status` | TEXT NOT NULL | 'active' | Estado no Operational Model |
| `last_published_at` | TIMESTAMPTZ | NULL | Timestamp da última publicação |

**Nota:** `venue_id` NÃO é adicionado — já existe em public.activities com FK correcta.

---

## Decisões específicas

**`engine_status` em vez de `status`**
O campo usa o prefixo `engine_` para evitar colisão futura com campos do app.
`status` é demasiado genérico para reservar. O engine usa `engine_status`.

**`product_key = 'legacy'` para registos existentes**
Os 11 venues e 21 activities existentes são do piloto UK — não pertencem
a nenhum produto da engine actual. O valor 'legacy' sinaliza isso sem inventar
um product_key que não existe (ex: 'vivere-uk-pilot').

**`engine_venue_id UNIQUE`**
Garante que o mesmo staging venue nunca é publicado duas vezes.
O Publishing Engine verifica este campo para implementar idempotência.

**Campos preservados — nunca escritos pelo engine**

Em public.venues: `category`
Em public.activities: `category`, `schedule`, `price`, `is_free`,
  `is_sponsored`, `recurrence_type`, `recurrence_days`, `recurrence_time`,
  `interested_count`

O PublicationTransformer usa lista positiva (whitelist). Qualquer campo
não na whitelist é automaticamente preservado.

**`imagem_url` (typo)**
O campo existe com typo em public.activities. A engine adapta-se:
raw_activity_items.image_url → public.activities.imagem_url.
O typo não é corrigido nesta fase — decisão adiada para ADR futuro.

---

## O que este ADR não decide

- Adicionar índices a public.venues ou public.activities — desnecessário por agora
- Corrigir o typo `imagem_url` — decisão futura
- Adicionar product_key como FK para public.products — simplificação aceitável no MVP
- Quando executar migration 0016 (FKs promoted_*_id) — após Sprint 8.7
