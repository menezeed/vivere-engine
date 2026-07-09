# ADR-0018 — Campos Preservados: o Engine Nunca Escreve

**Status:** Aceito
**Data:** 2026-07-08

---

## Decisão

O PublicationTransformer usa uma **lista positiva (whitelist)** de campos
que escreve. Qualquer campo não na whitelist é automaticamente preservado —
o engine nunca os toca, mesmo que existam dados correspondentes em staging.

---

## Campos preservados em public.venues

| Campo | Razão |
|---|---|
| `category` | Campo livre do app — formato diferente da engine |

## Campos preservados em public.activities

| Campo | Razão |
|---|---|
| `category` | Campo livre do app |
| `schedule` | Texto livre do app, formato diferente |
| `price` | Dado comercial — não vem das fontes actuais |
| `is_free` | Derivado de price — lógica do app |
| `is_sponsored` | Relação comercial — fora do scope da engine |
| `recurrence_type` | Modelo de recorrência do app |
| `recurrence_days` | Modelo de recorrência do app |
| `recurrence_time` | Modelo de recorrência do app |
| `interested_count` | Dado do utilizador — incrementado pelo app |

---

## Whitelist definitiva — o que o engine ESCREVE

### public.venues
`name`, `address`, `lat`, `lng`, `phone`, `website`, `opening_hours`,
`image_url`, `engine_venue_id`, `source_key`, `product_key`,
`engine_status`, `last_published_at`

### public.activities
`title`, `description`, `start_date`, `end_date`, `imagem_url`, `url`,
`phone`, `venue_id`, `engine_activity_id`, `source_key`, `product_key`,
`engine_status`, `last_published_at`

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
```
