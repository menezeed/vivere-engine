# ADR-0018 — Campos Preservados: o Engine Nunca Escreve

**Status:** Aceito (revisto em 2026-09-27 — ver secção "Revisão
2026-09-27"; revisto novamente em 2026-10-01 — ver secção "Revisão
2026-10-01")
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

## Revisão 2026-10-01 (Activity 14/26, Fase 14B) — Contrato de Recorrência V1, confirmado por código

Esta secção regista, com precisão, o que o Activity Discovery V1
**realmente produz** hoje — distinto do que o contrato a jusante
(domínio/app) **reconhece**. Confirmado por inspecção directa de
`src/pipeline/stages/02-recurrence-detection/` ao longo das Activities
8–10B e 13 (F5–F10).

### Tipos declarados no contrato de domínio

```typescript
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
```

### O que o detector de Discovery V1 realmente produz

**Apenas `'weekly'`, ou `null`** (que o `PublicationTransformer` normaliza
para `'none'` explícito na escrita pública — nunca depende do `DEFAULT`
da coluna, ver secção anterior).

`'daily'`, `'biweekly'` e `'monthly'` são reconhecidos pelo contrato de
domínio mais amplo, mas **nenhum caminho de código do detector de
Discovery V1 os produz actualmente**. Isto não é uma limitação de
publicação (o contrato aceita os cinco valores) — é uma limitação de
**detecção**: o `detectRecurrence.ts` nunca classifica nenhum texto como
`'daily'`, `'biweekly'` ou `'monthly'`.

### Semântica dos campos

- **`recurrence_days`**: array de inteiros 0–6, domingo=0 … sábado=6
  (confirmado pelo mapa `WEEKDAY_TO_NUMBER` em `detectRecurrence.ts`)
- **`recurrence_time`**: `'HH:MM'` ou `null`. `null` especificamente
  quando horários distintos por dia não são representáveis sem perda de
  informação (sinalizado por
  `review_reasons: ['recurrence_per_day_times_not_representable']`) —
  nunca um horário escolhido arbitrariamente de entre vários candidatos.

### Comportamentos confirmados por teste

- **Ocorrência única**: `occurrences=[{date,...}]`,
  `recurrence_type=null` — caminho normal, inalterado desde Activity 8/9.
- **Recurrence-only**: `occurrences=[]`, `recurrence_type='weekly'` —
  contrato definido em Activity 9, caminho de Discovery que o produz
  implementado em F6 (Activity 13).
- **Ocorrência + recorrência**: ambas preservadas simultaneamente,
  confirmado por teste explícito ("Caso E", Activity 8) — a recorrência
  nunca substitui uma ocorrência concreta já extraída.
- **Recorrência inválida/incompleta**: `recurrence_type` permanece `null`
  sempre que qualquer guarda de segurança dispara (semântica mensal
  ordinal não representável, data concreta associada à única menção de
  dia, etc.) — nunca publica uma regra parcial ou adivinhada.

### Não verificado nesta auditoria

`recurrence → none` em actualização, `none → recurrence` em actualização,
e republicação idempotente de recorrência **não foram exercitados com
dados reais** — nenhuma publicação real do Engine tinha acontecido até
2026-09-23 (0 de 48 `public.activities` com `engine_activity_id`
não-nulo, Backfill Safety Audit). Estes comportamentos dependem do
caminho de *dirty update* do Publishing, que ainda não processou uma
actividade recorrente real.

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
