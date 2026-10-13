# 10 — New Developer: Start Here

Welcome. You are joining to build the **AI Discovery Layer** for Vivere 60+. This page is the
5-minute version. Everything here is backed by the other onboarding documents and by the code.

## 1. What Vivere 60+ is

A platform that finds places and activities for people aged 60+ (today: Região dos Lagos, RJ and
São Paulo neighbourhoods), has humans review them, and publishes only approved records to a public
dataset consumed by a mobile app (not in this repo). Guiding rule: *better to lose a data point than to
publish a wrong one* (ADR-0003). → `01-PRODUCT-OVERVIEW.md`

## 2. Architecture in 5 minutes

```
Source → Collector → raw_* (append-only) → *_staging (pending_review)
       → Entity Resolution → Human Review (Admin Panel + Review API)
       → Publishing (only proposal_status = 'promoted') → public.venues / public.activities → app
```

- **Engine** = TypeScript CLIs run manually (`npx tsx --env-file=.env …`). No scheduler.
- **Supabase**: schema `staging` (raw, staging, ER, runs) and `public` (published data, app tables).
- **Review API** = Hono on :3001, service-role DB access, Supabase JWT auth, roles in `app_metadata.role`.
- **Admin Panel** = React/Vite on :5173.
→ `02-SYSTEM-ARCHITECTURE.md`, `03-DATA-MODEL-SPECIFICATION.md`, `04-ENGINE-PIPELINE.md`

## 3. What already exists

- Collectors: Google Places (venues, **paid**), WordPress municipal sites (activities).
- `RawActivityItem` contract and the generic `ActivityCollectorContract` + `IngestionOrchestrator`.
- Recurrence detection (PT-BR, weekly), venue filter, regional geographic gate.
- Entity Resolution (name/geo/address scoring, human decisions).
- Review state machine and Admin Panel.
- Publishing with stable identity (`UUIDv5(source_key:source_item_id)`), whitelist, archive-never-delete.
- RLS model for public tables.

## 4. What NOT to rebuild

| Don't build | Use instead |
|---|---|
| Your own DB writes to staging or public | `IngestionOrchestrator.runActivityIngestion` via an `ActivityCollectorContract` |
| Approval / promotion / publication logic | Review API + Publishing Engine |
| Structured recurrence (`recurrence_type/days/time`) | Stage `02-recurrence-detection` (give it verbatim text) |
| Venue matching / geocoding | Entity Resolution (give it a `venue_mention`) |
| Next-occurrence / expiry logic | `PublicationTransformer` (ADR-0020) |
| A second review UI | Extend the Admin Panel (later, via PR) |
| Changes to Activity Discovery V1 parsers | They are **frozen** (ADR-0023) |

## 5. AI Discovery Layer scope

**In scope (PROPOSED):** discover public sources (websites, social posts, images, videos, PDFs), capture
evidence, extract candidate events with an LLM, validate deterministically, map to `RawActivityItem`
with full provenance in `raw_payload.ai_discovery`, hand over through `ActivityCollectorContract`.

**Out of scope:** writing to any table directly, auto-approval, publishing, venue creation, structured
recurrence, changing publishing identity.

**Hard rule:** the AI Discovery Layer must NEVER bypass validation/review/publishing nor publish directly
into the public dataset. The LLM is never the source of truth. → `06-…CONTRACT.md`, `07-LLM-…SPECIFICATION.md`

## 6. Components you need to understand (in this repo)

1. `src/types/RawActivityItem.ts` — the payload you will produce.
2. `src/persistence/types/collectorContracts.ts` — the interface you will implement.
3. `src/persistence/orchestration/IngestionOrchestrator.ts` — `runActivityIngestion`.
4. `src/collectors/wordpress-content/` — a complete reference collector (+ `mapToRawActivityItems.ts`, `raw_payload` conventions).
5. `src/pipeline/stages/02-recurrence-detection/detectRecurrence.ts` — which fields it reads.
6. `src/publishing/services/activityIdentity.ts` and `ActivityPublisher.ts` — why `source_item_id` must be stable.
7. `src/publishing/repositories/impl/PublishableActivityRepository.ts` — the publication gate.
8. ADRs 0001, 0002, 0003, 0018, 0019, 0020, 0023 (in `docs/adr/`, Portuguese).

The mobile app is in another repository (not reviewed here).

## 7. Local setup (short)

```bash
npm ci && (cd admin-panel && npm ci)
cp .env.example .env            # Windows: copy .env.example .env — fill with STAGING credentials only
npx vitest run                  # To be confirmed: no npm test script exists
npx tsx --env-file=.env src/review-api/server.ts
(cd admin-panel && npm run dev)
```

Ask for a **staging** Supabase project and a reviewer account; do not use production keys.
Never run Google Places scripts (paid) without authorization. → `08-LOCAL-DEVELOPMENT.md`

## 8. Recommended reading order

1. This page
2. `01-PRODUCT-OVERVIEW.md`
3. `02-SYSTEM-ARCHITECTURE.md`
4. `06-AI-DISCOVERY-INTEGRATION-CONTRACT.md`
5. `04-ENGINE-PIPELINE.md`
6. `03-DATA-MODEL-SPECIFICATION.md`
7. `07-LLM-DISCOVERY-SPECIFICATION.md`
8. `05-REVIEW-API-AND-ADMIN.md`
9. `09-SECURITY-AND-ACCESS.md`
10. `08-LOCAL-DEVELOPMENT.md` (while setting up)
11. ADRs listed in §6

## 9. First safe development task (PROPOSED)

**"Offline AI candidate mapper + validator, no network, no DB."**

- Write a pure function `toRawActivityItem(candidate: AiCandidate): { item?: RawActivityItem; error?: … }`
  plus the deterministic validator from `07` §3–§4 (evidence quotes are verbatim substrings, dates valid,
  `language ∈ {pt,en}`, `confidence_hint` mapping, stable `source_item_id`).
- Feed it hand-written fixture JSON (no LLM calls), and unit-test it with Vitest.
- Then run the result through `detectRecurrenceItems()` in a test to see what the Engine would derive.
- Optionally implement a stub `AiDiscoveryCollector` reading fixtures from disk and run it with
  `IngestionOrchestrator.runActivityIngestion(..., { dryRun: true })`, constructing the orchestrator with
  mock repositories via `RepositoryFactory.fromObject(...)` (as the existing orchestrator tests do) — in
  dry-run mode no repository is called, so no database or credentials are needed.

Deliver as a PR with tests. No migrations, no Engine changes, no paid calls. Before any DB-writing
or paid work, an ADR (suggested ADR-0025) must be approved.

## 10. Open questions (need a decision before going further)

1. `source_key` strategy for AI sources and who seeds `public.sources` (`06` Q1).
2. Is a new collector type allowed under the Discovery V1 freeze, or is ADR-0025 required? (`06` Q8)
3. Identity stability of `source_item_id` across model versions (`06` Q3).
4. Where AI run metrics and source snapshots are stored (new table/bucket ⇒ migration) (`06` Q5–Q6).
5. Legal/ToS policy for social media, images, videos and PDFs (`06` Q7).
6. Which LLM provider(s) and monthly budget; who authorizes paid calls (`07` §14).
7. Review UI changes to show AI evidence before AI items reach reviewers (`06` Q10).
8. Cross-source duplicates between AI items and existing WordPress items (`06` B.6).
9. Fix for Review API read access by any authenticated user (`09` SEC-A) before exposing more data.

## 11. Audit notes (2026-10-10)

The onboarding pack was cross-checked against the code, migrations, `package.json` files and env
templates. Corrections applied in that audit:

- Regions list completed (Araruama is a Google Places region; WordPress sources exist only for Cabo Frio
  and São Pedro da Aldeia).
- Source priority: declared in configs but consumed by no logic.
- ER thresholds: added the `ambiguous` (≥ 2 candidates ≥ 0.85) and `unresolved` (0.50–0.85) bands.
- WordPress relevance classifier is not connected; only `category_id` restricts the fetch.
- ER diagram cardinalities fixed (`raw_venue_items → venues_staging` is 1:N since 0004).
- Local env files point at the **production** Supabase project — new finding SEC-O in `09`.
- Admin Panel production env key type is unidentified (not a JWT) — no longer described as an anon key.
- Staging isolation from `anon` is intended, not proven for production grants.
- AI layer wording: no own DB write path; staging dedup is an Engine responsibility; AI confidence is
  distinct from ER `resolution_confidence`.
- `ingest-wordpress-content.ts --dry-run` still requires DB env vars.

Still **not verified** (out of reach of a static read): live production schema/grants, git history for
committed secrets, test suite results, the mobile app's queries, and hosting of the Review API / Admin Panel.
