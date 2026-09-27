# ADR-0018 — Campos Preservados: o Engine Nunca Escreve

**Status:** Aceito (revisto em 2026-09-27 — ver secção "Revisão 2026-09-27")
**Data:** 2026-07-08

---

## Decisão original (2026-07-08)

O PublicationTransformer usa uma **lista positiva (whitelist)** de campos
que escreve. Qualquer campo não na whitelist é automaticamente preservado —
o engine nunca os toca, mesmo que existam dados correspondentes em staging.

---

## Campos preservados em public.venues

| Campo | Razão |
|---|---|
| `category` | Campo livre do app — formato diferente da engine |

## Campos preservados em public.activities (estado original, 2026-07-08)

| Campo | Razão |
|---|---|
| `category` | Campo livre do app |
| `schedule` | Texto livre do app, formato diferente |
| `price` | Dado comercial — não vem das fontes actuais |
| `is_free` | Derivado de price — lógica do app |
| `is_sponsored` | Relação comercial — fora do scope da engine |
| `recurrence_type` | Modelo de recorrência do app *(revisto — ver abaixo)* |
| `recurrence_days` | Modelo de recorrência do app *(revisto — ver abaixo)* |
| `recurrence_time` | Modelo de recorrência do app *(revisto — ver abaixo)* |
| `interested_count` | Dado do utilizador — incrementado pelo app |

**Razão original para `recurrence_*` estarem aqui**: em 2026-07-08, o
Engine não tinha nenhuma capacidade de detectar ou interpretar recorrência
a partir do texto das fontes — `recurrence_type`/`days`/`time` eram
inteiramente um modelo de dados do *app*, preenchido manualmente ou por
processos fora do Engine. Não fazia sentido o Engine escrever (ou
sobrescrever) um campo que não tinha como produzir correctamente.

---

## Revisão 2026-09-27 (Activity 9/26 — Level 3)

**O que mudou**: entre 2026-07-08 e 2026-09-27, o Engine ganhou um
*pipeline* estruturado de detecção e interpretação de recorrência
(Activity 8/26 — estágio `02-recurrence-detection`, migration 0018 de
`staging.activities_staging`). O Engine agora sabe, a partir do texto
real das fontes (ex: "toda sexta-feira, das 10h às 15h"), produzir
`recurrence_type`/`recurrence_days`/`recurrence_time` estruturados, com
tratamento explícito e testado de casos incompletos/inválidos
(nunca publica uma regra quebrada) e de perda de informação (nunca
descarta silenciosamente um horário de fim que não cabe no modelo,
preserva-o em `raw_activity_items.recurrence_text_hint`).

**Decisão revista (Level 3, Decision 1, aprovada)**: `recurrence_type`,
`recurrence_days` e `recurrence_time` **saem** da lista de campos
preservados/nunca-escritos e **entram** na whitelist real de escrita do
Engine, para *activities* geridas pelo Engine e processadas pelo
*pipeline* aprovado.

**O que NÃO mudou**: `category`, `schedule`, `price`, `is_free`,
`is_sponsored`, `interested_count` continuam exactamente como antes —
campos preservados, nunca escritos pelo Engine. Esta revisão aplica-se
**exclusivamente** a `recurrence_*`.

**Regra de resolução explícita** (nunca depender do `DEFAULT` da coluna):
`recurrence_type` é sempre escrito pelo Engine com um valor explícito —
`'none'` quando não há recorrência válida, nunca `NULL` à espera que o
`DEFAULT 'none'` do Postgres se aplique (esse `DEFAULT` só actua sobre
campos *omitidos* do `INSERT`, nunca sobre um valor `NULL` explícito).

**Elegibilidade de publicação** (Level 3, Decision 2, aprovada): uma
*activity* com recorrência estruturada válida passa a ser publicável
mesmo sem nenhuma ocorrência concreta futura (`occurrences=[]`) —
`start_date`/`end_date` ficam `NULL`, nunca inventados. Ver ADR-0020,
secção "Revisão 2026-09-27", para a actualização correspondente ao
*gate* de elegibilidade.

---

## Whitelist definitiva — o que o engine ESCREVE

### public.venues
`name`, `address`, `lat`, `lng`, `phone`, `website`, `opening_hours`,
`image_url`, `engine_venue_id`, `source_key`, `product_key`,
`engine_status`, `last_published_at`

### public.activities (revisto 2026-09-27)
`title`, `description`, `start_date`, `end_date`, `imagem_url`, `url`,
`phone`, `venue_id`, `engine_activity_id`, `source_key`, `product_key`,
`engine_status`, `last_published_at`, `recurrence_type`, `recurrence_days`,
`recurrence_time`

### public.activities — campos que continuam preservados
`category`, `schedule`, `price`, `is_free`, `is_sponsored`,
`interested_count`

---

## Implementação

```typescript
// PublicationTransformer — UPDATE sempre explícito, nunca SELECT *
await db.from('venues').update({
  name, address, lat, lng, phone, website, opening_hours,
  image_url, engine_venue_id, source_key, product_key,
  engine_status, last_published_at,
}).eq('id', publicVenueId);
// category, etc. nunca aparecem aqui

// PublicActivityRepository (revisto 2026-09-27) — recurrence_* incluído
await db.from('activities').update({
  title, description, start_date, end_date, imagem_url, url, phone,
  venue_id, recurrence_type, recurrence_days, recurrence_time,
  last_published_at,
}).eq('id', publicActivityId);
// category, schedule, price, is_free, is_sponsored, interested_count
// continuam a NUNCA aparecer aqui
```
