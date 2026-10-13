# 01 — Product Overview

> **Status of this document:** descriptive, AS-IS. Audited against code on 2026-10-10 (see audit notes in `10-NEW-DEVELOPER-START-HERE.md` §11). Written from the contents of the
> `vivere-engine` repository (code, migrations, ADRs, docs) as of the commit whose
> last message is `feat(db): enable RLS on engine public tables` (branch `main`).
> Anything that cannot be proven from the repository is marked
> **Unknown / To be confirmed**. Anything that is a suggestion is marked **PROPOSED**.

---

## 1. What Vivere 60+ is

Vivere 60+ is the first product of the **Vivere Platform**: a platform that acquires,
curates and publishes data about **places (venues)** and **activities/events** relevant to
people aged 60+.

Evidence in the repository:

| Fact | Evidence |
|---|---|
| The platform is called Vivere and is designed to be multi-product; Vivere 60+ is the first product | `docs/adr/ADR-0004-plataforma-vivere-multi-produto.md`, `docs/architecture/current/01-platform.md` |
| The product key used in code is `vivere-60-mais` | `src/collectors/wordpress-content/config/cabo-frio.ts`, `admin-panel/src/components/layout/AppShell.tsx` (`PRODUCTS = [{ key: 'vivere-60-mais', label: 'Vivere 60+' }]`) |
| The product was previously called "Vida Ativa 60+" | ADR-0004 |
| A mobile app consumes published data from `public.venues` / `public.activities` | ADR-0019 (Operational Model), migration `0000_app_baseline.sql` (legacy app schema) |
| Configured regions are Brazilian: Região dos Lagos (Cabo Frio, Araruama, São Pedro da Aldeia, Iguaba Grande) and São Paulo neighbourhoods (Brooklin, Campo Belo, Moema, Santo Amaro) for Google Places venues; WordPress activity sources exist for Cabo Frio and São Pedro da Aldeia only. Which regions actually have published data is **To be confirmed** (not derivable from code) | `src/collectors/google-places/config/vivere-60-mais.ts` (`regions`), `src/collectors/wordpress-content/config/registry.ts`, `docs/regional-baselines/*`, ADR-0008, ADR-0021 |
| A UK pilot (Richmond upon Thames) is explicitly **deferred** | ADR-0010 (status "Adiado") |

The mobile app itself is **not** in this repository. Its code, release state and exact
queries are **Unknown / To be confirmed** from this repository.

## 2. Problem the product solves

From the ADRs and docs (not from user research, which is not in the repo):

- Activities relevant to older adults are scattered across municipal news portals
  (WordPress sites of *prefeituras*), and venues are discoverable through Google Places.
- Source data is noisy: dates are written in free text, venues are only *mentioned*,
  recurrence ("toda sexta-feira") is ambiguous, and search APIs leak results outside
  the target region (ADR-0022).
- Publishing wrong data to a 60+ audience is considered worse than publishing nothing:
  *"É preferível perder um dado do que publicar um dado incorreto."*
  (`docs/architecture/current/06-review-engine.md`, ADR-0003).

The Engine therefore turns external data into **curated, human-approved, traceable**
records before anything reaches the public dataset.

Business metrics, target users, monetisation, and market sizing are
**Unknown / To be confirmed** (not present in the repository).

## 3. Core domain concepts

| Concept | Meaning in this codebase | Where defined |
|---|---|---|
| **Product** (`product_key`) | Logical partition of the platform (e.g. `vivere-60-mais`). Every staging row and every engine-published public row carries it. | `public.products` (migration 0001), ADR-0004, ADR-0017 |
| **Source** (`source_key`) | An origin of data, e.g. `google_places`, `prefeitura_cabo_frio`, `prefeitura_sao_pedro_da_aldeia`. | `public.sources` (0001), collector configs |
| **Collector** | Code that talks to one *technology* of source (WordPress REST API, Google Places API) and returns raw contracts. "Fiel e burro" — faithful and dumb: no business decisions. | ADR-0001, `src/collectors/*` |
| **RawVenueItem** | Raw contract for sources with *authority over places* (lat/lng/phone/website). | `src/types/RawVenueItem.ts`, ADR-0002 |
| **RawActivityItem** | Raw contract for sources with *authority over events*. Carries a `venue_mention` (textual claim), never a resolved venue. | `src/types/RawActivityItem.ts`, ADR-0002 |
| **VenueMention** | What the source *said* about where an event happens (`raw_text`, `raw_address_text`, `confidence_hint`). | `src/types/RawActivityItem.ts` |
| **Occurrence** | A concrete date (`date` required, optional `time`, `end_date`, `end_time`) mentioned by the source. | `RawOccurrence` in `RawActivityItem.ts`, ADR-0020 |
| **Recurrence** | Structured rule (`recurrence_type`, `recurrence_days`, `recurrence_time`) derived from text. Discovery V1 only produces `weekly` or `null`. | Migration 0018, `src/pipeline/stages/02-recurrence-detection`, ADR-0018 |
| **IngestionRun** | Audit record of one pipeline execution (collection or reprocessing). | `staging.ingestion_runs`, `IngestionOrchestrator.ts` |
| **Layer A — Raw** | `staging.raw_venue_items`, `staging.raw_activity_items`. Append-only evidence. | Migrations 0001, 0002 |
| **Layer B — Staging / Curation** | `staging.venues_staging`, `staging.activities_staging`. Proposals awaiting review. | Migration 0001+ |
| **Layer C — Operational Model** | `public.venues`, `public.activities`. The canonical, consumer-facing dataset. | ADR-0019 |
| **Entity Resolution (ER)** | Links an activity's `venue_mention` to a reviewed venue in staging. | `src/entity-resolution/`, ADR-0011..0013 |
| **Human Review** | `proposal_status` state machine (`pending_review → approved → promoted`, or `rejected`). | `src/review-api/`, ADR-0009 |
| **Publishing Engine** | The only component authorised to write engine data into `public.venues` / `public.activities`. | `src/publishing/`, ADR-0019 Invariant 1 |
| **Geographic status** | `inside_radius` / `buffer_zone` / `outside_region` for venues, independent of curation status. | Migration 0021, ADR-0022 |
| **Activity Discovery V1** | The **existing** (non-AI) activity extraction pipeline (WordPress parsing + recurrence detection). **Frozen** by ADR-0023. | ADR-0023 |

> ⚠ **Naming collision to be aware of:** the repository already uses the term
> **"Activity Discovery V1"** for the existing, deterministic WordPress-based extraction
> pipeline. The new **AI Discovery Layer** is a different, future component. Do not
> confuse them in code, ADRs, or PR titles. See `06-AI-DISCOVERY-INTEGRATION-CONTRACT.md`.

## 4. The role of the Engine

The Engine (`vivere-engine`, package name in `package.json` is still `vaip-engine`) is a
set of TypeScript CLIs and one HTTP service that:

1. **Collect** raw items from configured sources (CLI scripts, run manually).
2. **Persist** raw evidence append-only (Layer A).
3. **Filter / gate / detect** (venue filter, regional geographic gate, recurrence detection).
4. **Stage** proposals with `proposal_status = 'pending_review'` (Layer B).
5. **Resolve** activity venue mentions against reviewed venues (Entity Resolution CLI).
6. **Expose** staging to humans via the **Review API** (Hono) and the **Admin Panel** (React/Vite).
7. **Publish** only human-promoted records into the Operational Model (Publishing CLI).

There is **no scheduler** today: every step is triggered manually by an operator
(ADR-0014: "Opção C — Execução manual via CLI").

## 5. General data flow (AS-IS)

```mermaid
flowchart LR
  subgraph Sources
    GP[Google Places API]
    WP[Prefeitura WordPress sites]
  end
  GP -->|RawVenueItem| C1[GooglePlacesCollector]
  WP -->|RawActivityItem| C2[WordPressContentCollector]
  C1 --> O[IngestionOrchestrator]
  C2 --> O
  O -->|append-only| A[(Layer A: staging.raw_*)]
  O -->|filter, geo gate, recurrence| B[(Layer B: staging.*_staging\nproposal_status=pending_review)]
  B --> ER[Entity Resolution CLI]
  ER --> B
  B <--> API[Review API :3001]
  API <--> UI[Admin Panel :5173]
  B -->|only proposal_status=promoted| P[Publishing CLI]
  P --> C[(Layer C: public.venues / public.activities)]
  C --> APP[Vivere 60+ mobile app\n(not in this repo)]
```

## 6. What can be proven from the repository

- The three-layer model (Raw → Staging → Operational) and its migrations (0000–0022).
- Two real collectors: Google Places (venues) and WordPress content (activities), plus an older
  `prefeitura-agenda-cultural` collector folder that shares `source_key = 'prefeitura_cabo_frio'`.
- Human-in-the-loop gates: activities are only publishable when
  `proposal_status = 'promoted'` **and** `venue_resolution_status IN ('matched','proposed_new')`
  (`PublishableActivityRepository.findUnpublished/findDirty`).
- Role-based review (`viewer`, `reviewer`, `admin`) via Supabase Auth `app_metadata.role`.
- Stable activity identity: `engine_activity_id = UUIDv5(source_key + ':' + source_item_id)`
  (`src/publishing/services/activityIdentity.ts`).
- RLS model for public tables (migrations 0020, 0022; ADR-0024).

## 7. Unknown / To be confirmed (product)

| Topic | Status |
|---|---|
| Mobile app repository, release status and which columns/filters it actually uses (e.g. whether it filters `engine_status = 'active'` and `product_key`) | Unknown / To be confirmed |
| Product roadmap beyond ADRs (other products: Família, Kids, Turismo, Cultura, Saúde) | Only named in ADR-0004 / `01-platform.md`; no implementation |
| UK market launch scope and timing | Deferred (ADR-0010); current status To be confirmed |
| Who the human reviewers are and expected review throughput | Unknown (ADR-0023 lists "carga de revisão multi-fonte não estabelecida") |
| Production hosting of the Review API and Admin Panel (URLs, platform) | Unknown / To be confirmed (only a `VITE_API_BASE_URL` variable exists) |
| Data retention policy for raw data and runs | "Decisão operacional pendente" (comment in migration 0001) |
| Legal/terms constraints for scraping social media, images, videos, PDFs | Unknown / To be confirmed — critical for the AI Discovery Layer |
