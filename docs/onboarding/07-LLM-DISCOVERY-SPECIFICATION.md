# 07 — LLM Discovery Specification (PROPOSED)

> **Status: PROPOSED.** No LLM, OCR, transcription or embedding code exists in the repository
> (verified by search). This document specifies how LLMs *should* be used inside the future AI
> Discovery Layer so that its output satisfies the contract in `06-AI-DISCOVERY-INTEGRATION-CONTRACT.md`.
>
> Two non-negotiable principles:
> 1. **The LLM is never the source of truth.** The source publication is. The LLM is an extraction
>    tool whose every output must be justified by verbatim evidence from the source.
> 2. **Every published field must remain traceable to the original source** (URL + stored text/snapshot
>    + quote), through the existing Engine pipeline and Human Review.

These principles align with existing Engine decisions: ADR-0001 (collector "fiel e burro"),
ADR-0002 (activity sources only *mention* venues), ADR-0003 ("Nunca inventar"), ADR-0023 (discovery
produces proposals, never publication authority).

---

## 1. Discovery vs extraction responsibilities

| Phase | Purpose | LLM allowed? | Output |
|---|---|---|---|
| **Discovery** | Find *candidate sources* likely to contain 60+-relevant events (URLs, posts, PDFs, images) | Optional (ranking/classification only) | List of source references with fetch metadata |
| **Capture** | Fetch and store the exact content; OCR images/PDFs; transcribe video/audio | No LLM for the content itself (OCR/ASR tools are fine; their output is stored as evidence) | `raw_text` + `content_sha256` + snapshot ref |
| **Extraction** | Turn captured text into structured event candidates | Yes | JSON per output schema |
| **Validation** | Check schema, evidence, dates, constraints | **No** (deterministic code only) | valid items / errors |
| **Mapping** | Build `RawActivityItem` + `raw_payload.ai_discovery` | No | items for `ActivityCollectorContract` |
| Recurrence rule, venue resolution, approval, publishing | — | **No** — owned by the Engine and humans | — |

Rationale: if the LLM is used to *discover* and also to *validate* its own extraction, errors are
correlated. Validation must be independent and deterministic.

## 2. Structured output

- Use the provider's structured-output / JSON-schema mode where available; otherwise strict JSON
  instructions + parser. Either way the result is **re-validated** by our own validator (zod/ajv) —
  provider guarantees are not trusted.
- One schema, versioned (`output_schema_version`), stored in the repo.
- Proposed output schema (abridged):

```json
{
  "events": [
    {
      "title": { "value": "string", "quote": "string" },
      "dates": [ { "date": "YYYY-MM-DD", "time": "HH:MM|null", "end_date": "YYYY-MM-DD|null", "end_time": "HH:MM|null", "quote": "string" } ],
      "recurrence_phrase": { "value": "string|null", "quote": "string|null" },
      "venue": { "name": "string|null", "address": "string|null", "quote": "string|null", "explicitness": "explicit|contextual|ambiguous" },
      "price": { "value": "string|null", "is_free_stated": "true|false|null", "quote": "string|null" },
      "audience_60_plus": { "label": "explicit|plausible|unknown", "quote": "string|null" },
      "language": "pt|en|other",
      "uncertainties": ["string"]
    }
  ],
  "no_event_reason": "string|null"
}
```

- `explicitness` maps to `venue_mention.confidence_hint`: `explicit → explicit_name`,
  `contextual → inferred_from_context`, `ambiguous → ambiguous`.
- `language: other` ⇒ candidate becomes an error (DB CHECK allows only `pt`/`en`), unless the
  product decides otherwise (see `06` Q9).
- An empty `events` array with `no_event_reason` is a valid, expected outcome.

## 3. Schema validation (deterministic)

Run in this order; any failure → `errors[]` with a reason code, never an item:

1. JSON parses; matches schema exactly (no extra fields, enums respected).
2. Dates are real calendar dates; times are `00:00–23:59`; `end_date ≥ date` when present.
3. Date plausibility window relative to `published_at`/`fetched_at` (e.g. not more than N months in the
   past or future — N **To be decided**). Out of window → error or `review_reasons`.
4. Field lengths and character sanity (no HTML, no markdown artefacts).
5. Mapping produces values that satisfy DB constraints (`language`, `confidence_hint`, non-null `title`).

## 4. Hallucination prevention

| Control | Rule |
|---|---|
| Evidence-or-null | Every non-null field must carry a `quote` that is a **verbatim substring** (after whitespace normalisation) of the captured text. Fails → field set to `null` (or event rejected if it is `title`/date) |
| No arithmetic on dates | The model must not convert "próxima sexta" or "amanhã" into a date. Only explicit dates are allowed in `dates[]`; relative expressions go to `uncertainties` and `recurrence_phrase` only if they express a rule |
| No enrichment | No geocoding, no phone/website lookup, no category assignment, no "typical" times |
| No summarisation into source fields | `description` uses a verbatim excerpt, not an LLM summary (stage 02 recurrence detection reads `description`) |
| Closed vocabulary | Enums only; free text only inside `value`/`quote` |
| Temperature | Low / deterministic settings recorded in metadata |
| Year inference | If the source omits the year, do **not** infer it in the LLM; either use a deterministic rule in code tied to `published_at` and flag `review_reasons: ['year_inferred_from_publication_date']`, or reject — decision **To be made** |

## 5. Provenance

Stored per item in `raw_payload.ai_discovery` (see `06` §B.2): source URL, channel, publisher,
`published_at`, `fetched_at`, `content_sha256`, snapshot reference, evidence quotes with locators
(char offsets / PDF page / video timestamp), provider, model, prompt id+version, schema version,
tokens, cost, attempt number. `external_url` on the item is always the source URL.

## 6. Confidence scoring

- `confidence.overall` must be **computed deterministically** from checkable signals, not taken from
  the model. Proposed inputs (weights **To be calibrated** with real review outcomes, mirroring the
  Engine's own calibration approach in ADR-0011/0014):
  - evidence coverage (share of non-null fields with valid quotes);
  - date explicitness (explicit full date > date without year > weekday only);
  - venue explicitness;
  - source channel prior (could reuse `src/config/sourcePriority.ts` values, e.g. `instagram` 50, `facebook` 60 — currently unused config);
  - number of events in source (more → lower);
  - validator warnings count.
- `model_self_reported` may be stored for analysis only.
- This AI confidence lives only in `raw_payload.ai_discovery.confidence`. It is **not** the same thing as
  `activities_staging.resolution_confidence` (the Entity Resolution venue-match score) and must never be
  written there.
- **Confidence never changes routing to publication.** Every AI item enters as `pending_review` like
  every other item. Confidence may be used to **sort** the review queue or to **drop** clearly invalid
  items before hand-off — never to approve.

## 7. Dates and times

- Output local wall-clock `date` + `time` exactly as stated; no timezone conversion in the AI layer.
- Be aware the Engine currently treats them as UTC when selecting the next occurrence
  (`occurrenceSelection.ts`, up to 3h drift for `America/Sao_Paulo`) — this is an Engine gap, not to be
  "fixed" by shifting times in the AI layer.
- Multi-day events: `end_date`; separate start/end times (`time`, `end_time`), never a range in one field
  (contract rule in `RawOccurrence`).
- Recurring events: provide the verbatim phrase in `recurrence_text_hint`; **never** emit
  `recurrence_type/days/time` — the Engine's stage 02 owns that (currently PT-BR, weekly only).

## 8. Locations

- Output a textual venue mention and optional textual address only.
- Never output coordinates, never pick a venue from the Engine's database. Venue linking is Entity
  Resolution's job; it uses `confidence_hint` in scoring (+0.10 / 0 / −0.10).
- Online events: `venue: null` and `uncertainties += 'online_event'` (product decision needed on whether
  online events are in scope — **To be confirmed**).

## 9. Ambiguous events

| Situation | Handling |
|---|---|
| Several candidate dates, unclear association | Emit no date for that event; `review_reasons += 'ambiguous_dates'`; or drop (ADR-0003 precedent: `narrative_ambiguous` items are discarded) — policy **To be decided** |
| Several events in one post | Separate items; `multiple_events_in_source` |
| Past event / recap post | Drop (`no_event_reason: 'past_event'`) |
| Event without date or recurrence | Error, not an item |
| Unclear 60+ relevance | Keep item with `audience_60_plus: unknown`; humans decide |
| Image-only flyer | OCR text is the evidence; quotes must match OCR output |

## 10. Prompt / version tracking

- Prompts live in the repository as files (`prompts/<id>/<version>.md` or similar — **PROPOSED**),
  reviewed via PR like code.
- Each item records `prompt_id`, `prompt_version`, `output_schema_version`, `model`, `provider`.
- A golden set of real source documents with expected extraction (built from human-reviewed cases)
  is used for regression tests before changing prompts/models — analogous to the Engine's
  "Regional Baseline" rule ("isto piora Brooklin?", ADR-0021).

## 11. Retries

- Transport errors: exponential backoff, bounded attempts (pattern of `src/lib/retry.ts`:
  default 3 attempts, base 1s).
- Schema-invalid output: at most **one** repair attempt that includes the validator error; then fail.
- Never retry with higher temperature to "get an answer".
- Record `attempt` in metadata.

## 12. Deterministic validation before the Engine

Everything in §3–§4 runs in code, after the LLM and before mapping. The Engine adds its own existing
checks afterwards (DB constraints, `parseOccurrences`, recurrence validity, publishing gates). Neither
layer relies on the LLM to validate itself.

## 13. Human review

- All AI items enter `activities_staging` as `pending_review` / `unresolved` through the existing
  orchestrator. Approval and promotion remain human (`reviewer`, `admin`).
- Recommended (PROPOSED) before go-live: surface `ai_discovery.evidence`, `confidence`, `review_reasons`
  and the source link in the Activity detail page, so reviewers can verify quotes quickly.
- Measure review load per AI source (ADR-0023 already lists review load as unmeasured).

## 14. Token / cost considerations

- Budget per run and per month enforced **before** each call. Note the existing `budgetGuard.ts` only
  has an in-memory implementation; a persistent spend store (`staging.api_usage_log` /
  `staging.api_budget_config` are referenced in comments but not created by any migration) would need
  a migration + ADR.
- Skip extraction when `content_sha256` is unchanged since the last successful extraction.
- Pre-filter cheaply (keywords, date presence, category) before calling the model.
- Truncate/segment long documents deterministically; record what was sent.
- Paid calls require explicit authorization from the product owner (project principle; also
  `docs/engineering/ai-development-workflow.md` trigger #1 "Custo real").

## 15. Provider independence

- Define an internal interface, e.g. `LlmExtractor.extract(input, schema, promptRef) → {json, usage, model}`
  (PROPOSED), with one adapter per provider.
- No provider SDK types leak outside the adapter; provider and model ids are plain strings in metadata.
- Prompts must not rely on provider-specific features without a fallback.
- Golden-set evaluation is run per provider/model before switching.
