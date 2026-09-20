# ADR-0020 — Política de Publicação de Activities com Múltiplas Ocorrências

**Status:** Aceito
**Data:** 2026-07-10

---

## Contexto

Na validação com dados reais (Sprint 8.7), descobriu-se que
`raw_activity_items` não tem uma coluna `event_date` única, como o
Architecture Book v1.1 §5.2 assumia. Em vez disso, tem uma coluna
`occurrences` (jsonb): um array de datas mencionadas no conteúdo de origem,
cada uma com `date`, `time` opcional, `end_date` opcional e `end_time`
opcional.

```json
[{ "date": "2026-06-28", "time": "07:00", "end_date": null, "end_time": null }]
```

`public.activities.start_date`/`end_date` (ADR-0018) são campos únicos —
não há hoje suporte, no schema público nem no app, para uma activity com
múltiplas datas operacionais simultâneas. `occurrences` pode, no entanto,
conter mais do que uma entrada.

Adicionalmente: `activities_staging`/`raw_activity_items` não têm nenhum
campo `recurrence_type`/`recurrence_days`/`recurrence_time` — esses campos
já estavam excluídos da whitelist do ADR-0018, reservados a edição
manual/legacy. `occurrences` representa **datas concretas mencionadas na
fonte**, não uma regra de recorrência.

## Decisão

Na Fase 8, `public.activities` representa **apenas a próxima ocorrência
futura** de cada activity. A representação completa de múltiplas
ocorrências (uma activity operacional por ocorrência, ou um campo
`occurrences` publicado directamente) fica adiada para fase futura.

### Regra de selecção

1. Parsear `occurrences`.
2. Ordenar por `date` + `time`.
3. Seleccionar a primeira ocorrência cuja data/hora seja `>= asOf`.
4. Se existir:
   - mapear para `public.activities.start_date`/`end_date`;
   - continuar a publicação normalmente.
5. Se não existir nenhuma ocorrência `>= asOf`:
   - **não inserir** uma activity nova em `public.activities`;
   - se já tiver sido publicada anteriormente, **arquivar** o registo
     operacional (`engine_status = archived`);
   - nunca usar silenciosamente a última ocorrência passada.

`asOf` é **sempre injectado** pelo chamador (nunca `new Date()`/`Date.now()`
dentro do PublicationTransformer) — a decisão permanece determinística:
mesma entrada + mesmo `asOf` → sempre a mesma saída ou ausência de saída.
Ver ADR-0019 (Invariante 4).

### Fonte completa preservada

`occurrences` permanece intacto e append-only em `raw_activity_items`
(ADR-0001) independentemente da política de publicação. Nenhuma
informação é perdida — apenas não é toda representada em
`public.activities` nesta fase.

## Justificação

- Camada C (`public.*`) representa conteúdo operacional **actual** — uma
  activity com data já passada, marcada como `active`, seria informação
  enganosa para o utilizador final (público 60+, "o que há para fazer
  agora").
- Publicar a última ocorrência passada, por omissão, esconderia
  silenciosamente que a activity já não tem representação válida.
- `public.activities.start_date`/`end_date` como campos únicos já é uma
  decisão tomada (ADR-0018) — esta ADR não a reabre, apenas define como
  chegar a esse valor único quando a fonte tem múltiplas datas candidatas.

## Consequências

- Uma activity cuja única ocorrência futura passa a estar no passado só é
  reavaliada (e arquivada) quando entra novamente no conjunto "dirty" —
  isto é, quando chega um novo `raw_activity_items` com `collected_at` mais
  recente para essa staging activity. **Não há, na Fase 8, reavaliação
  periódica independente de nova ingestão.**
- Consequentemente, uma activity publicada pode continuar `active` em
  `public.activities` bem depois da sua ocorrência ter passado, se não
  houver nova recolha da fonte. Isto é uma lacuna conhecida, não resolvida
  por esta ADR.
- **O Scheduler da Fase 9** é responsável por (a) reavaliar expiração de
  activities publicadas independentemente de nova ingestão, e (b) avançar
  automaticamente para a ocorrência seguinte quando a actual expira.
- Multi-ocorrência operacional completa (uma activity pública por
  ocorrência, ou um campo `occurrences` exposto ao app) fica em backlog,
  sem data definida — decisão de produto a tomar quando houver casos de
  uso concretos (ex.: notificações por ocorrência).

## Alternativas consideradas

| Opção | Razão de rejeição (nesta fase) |
|---|---|
| Primeira ocorrência (não necessariamente futura) | Pode publicar activity já expirada — mesmo problema que esta ADR evita |
| Uma activity operacional por ocorrência | Quebra a relação 1:1 `engine_activity_id ↔ public.activities.id` (ADR-0015); exige nova identidade, diffing de ocorrências, e possivelmente mudanças a montante no Entity Resolution (Fase 7, congelada) |
| Publicar `occurrences` como campo próprio em `public.activities` | Exige migration nova e não tem consumidor (app não lê este campo hoje); mantido em backlog |

## Bug de persistência relacionado (não coberto por esta ADR)

Independentemente da política de publicação, `occurrences` está hoje
persistido como uma **string JSON dentro de jsonb**
(`jsonb_typeof(occurrences) = 'string'`), em vez de um array jsonb nativo —
provavelmente um bug do Collector de origem (serialização dupla antes da
escrita). Correcção em três partes, tratada separadamente:

1. Corrigir o Collector/repositório de persistência para novas linhas
   gravarem array jsonb nativo.
2. Migration de backfill, convertendo apenas linhas onde
   `jsonb_typeof(occurrences) = 'string'`.
3. `PublishableActivityRepository` mantém, entretanto, um parser tolerante:
   aceita array nativo ou string JSON; qualquer outra forma é um erro
   explícito (nunca falha silenciosamente para `[]`).
