# 08 — Local Development

> Derived from `package.json` files, script headers and ADR-0009. Commands marked
> **To be confirmed** were not executed while writing this document.
>
> ⚠ **Cost warning.** Several scripts call the **paid** Google Places API, including the
> `dry-run-google-places.ts` script ("dry run" means *no DB writes*, not *no API calls*). Never run
> `dry-run-google-places.ts`, `ingest-google-places.ts` or `ingest-targeted-venues.ts` without explicit
> authorization from the product owner.
>
> ⚠ **Environment warning.** The maintainer's local `.env` and the tracked
> `admin-panel/.env.development` both point at the **production** Supabase project (project ref matches
> the one the runbook names as production), and the `.env` holds a **service_role** key. Any non-dry-run
> CLI — and any Review API started with that `.env` — reads and writes **production**. A new developer
> must not reuse these files; create a separate staging project (`docs/runbooks/staging-bootstrap.md`)
> and point both `.env` and `admin-panel/.env.development` at it.

---

## 1. Prerequisites

| Requirement | Evidence | Notes |
|---|---|---|
| Node.js | No `.nvmrc` and no `engines` field. `@types/node ^20.14` in devDependencies; scripts use `node --env-file` via `tsx --env-file=.env` (Node ≥ 20.6 feature); Review API uses global `fetch` and Web Crypto | **Node 20 LTS or newer** is the safe inference — exact version **To be confirmed** |
| npm | `package-lock.json` in root and in `admin-panel/` | |
| Supabase project | `db/migrations`, runbook | Staging schema must be **exposed in the Data API** (runbook §4) |
| `public.products` / `public.sources` rows | FKs from staging tables | Not seeded by the repo — insert manually (runbook §6, "PENDENTE") |
| OS | Script comments mention Windows path handling (`file:///C:/app/...`) | Development happens on Windows today; POSIX should work but is **To be confirmed** |

## 2. Install

```bash
# Engine (repo root)
npm ci            # or: npm install

# Admin Panel
cd admin-panel
npm ci            # or: npm install
```

## 3. Environment variables (names only)

### Engine / Review API — `.env` at repo root (template: `.env.example`)

| Variable | Required for | Notes |
|---|---|---|
| `SUPABASE_URL` | All DB access, Review API JWKS | |
| `SUPABASE_SERVICE_KEY` | All DB access (service_role, bypasses RLS) | Never expose to browsers/mobile |
| `CORS_ORIGIN` | Review API in production | If unset and `NODE_ENV=production`, the API exits; in development it allows `localhost:5173/3000/4173` |
| `GOOGLE_PLACES_API_KEY` | Google Places scripts | Paid |
| `LOG_LEVEL` | optional | default `info` |
| `REVIEW_API_PORT` | optional | default `3001` |
| `NODE_ENV` | optional | default `development` |
| `SUPABASE_ANON_KEY` | security harness only | |
| `SECURITY_TEST_USER_EMAIL`, `SECURITY_TEST_USER_PASSWORD`, `SECURITY_TEST_ADMIN_EMAIL`, `SECURITY_TEST_ADMIN_PASSWORD` | security harness only (`scripts/security-rls-validation.ts`) | Dedicated test accounts |

`SUPABASE_JWT_SECRET` appears in the maintainer's local `.env` but is **not used by any code** and is
not in `.env.example`.

The engine does **not** use `dotenv`; pass `--env-file=.env` to `tsx`.

### Admin Panel — `admin-panel/.env.development` / `.env.production`

| Variable | Notes |
|---|---|
| `VITE_API_BASE_URL` | Review API base URL (e.g. local `http://localhost:3001`) |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (used only for Supabase Auth login) |

## 4. Run the Review API

```bash
npx tsx --env-file=.env src/review-api/server.ts
# → http://localhost:3001/health
```

There is no npm script for this. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.

## 5. Run the Admin Panel

```bash
cd admin-panel
npm run dev         # Vite on http://localhost:5173
```

Login uses Supabase Auth email/password. The user needs `app_metadata.role` set to `reviewer` or
`admin` to perform actions (`viewer` is the default for any account). How roles are assigned in the
Supabase project is **To be confirmed** (not scripted in the repo).

## 6. Ports

| Service | Port | Source |
|---|---|---|
| Review API | 3001 (`REVIEW_API_PORT`) | `server.ts` |
| Admin Panel (Vite dev) | 5173 | `admin-panel/vite.config.ts` |
| Vite preview | 4173 (Vite default; allowed by dev CORS list) | `server.ts` CORS list |

## 7. Engine CLIs (reference)

All need `--env-file=.env`. Safe = no writes and no paid calls.

| Command | Writes DB? | Paid API? |
|---|---|---|
| `npx tsx --env-file=.env scripts/dry-run-wordpress-content.ts --instance=cabo-frio` | no | no |
| `npx tsx --env-file=.env scripts/ingest-wordpress-content.ts --instance=cabo-frio --dry-run` | no (but still builds the Supabase client, so DB env vars are required) | no |
| `npx tsx --env-file=.env scripts/ingest-wordpress-content.ts --instance=<key> [--since-days=N]` | **yes** | no |
| `npx tsx --env-file=.env scripts/dry-run-google-places.ts --product=vivere-60-mais --region=<key> [--limit=N]` | no (writes local snapshot JSON) | **yes** |
| `npx tsx --env-file=.env scripts/ingest-google-places.ts --region=<key>` | **yes** | **yes** |
| `npx tsx --env-file=.env scripts/reprocess-venues-from-raw.ts --region=<key> --dry-run` | no | no |
| `npx tsx --env-file=.env src/entity-resolution/run.ts --product-key=vivere-60-mais --dry-run` | no (env check only) | no |
| `npx tsx --env-file=.env src/entity-resolution/run.ts --product-key=vivere-60-mais` | **yes** | no |
| `npx tsx --env-file=.env src/publishing/publish.ts --product-key=vivere-60-mais --preview` | no (reads real data) | no |
| `npx tsx --env-file=.env src/publishing/publish.ts --product-key=vivere-60-mais` | **yes — public dataset** | no |

Only one npm script exists at root: `npm run dry-run:google-places` (paid).

## 8. Tests

- Framework: Vitest 4 (`devDependencies`). Test files live in `__tests__/` folders across `src/` and `scripts/`.
- There is **no `test` script** and no Vitest config file at the root. Suggested invocation
  (**To be confirmed**):

```bash
npx vitest run                 # all tests
npx vitest run src/publishing  # one area
```

- Most tests use mocks via `RepositoryFactory.fromObject` and do not need a database. Integration
  scripts (`scripts/validate-*.ts`, `scripts/security-rls-validation.ts`) hit a real Supabase project.
- The Admin Panel has no test setup.

## 9. Type-check and build

```bash
# Engine: no build step (executed with tsx). Type-check:
npx tsc --noEmit               # uses root tsconfig.json (src + scripts) — To be confirmed

# Admin Panel:
cd admin-panel
npm run build                  # tsc -b && vite build → admin-panel/dist
```

## 10. Database setup for a fresh environment

Follow `docs/runbooks/staging-bootstrap.md` (status: "rascunho … Ainda não validado em execução"):
apply `0000 → 0022` manually in order on a **new** project only, expose `staging` in the Data API,
insert `products`/`sources`, and apply/revert the temporary harness privileges only around the security
harness run. Never apply `0000` or any `*.rollback.sql` to production.

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios…` | Missing `--env-file=.env` or vars |
| PostgREST error about schema `staging` not found/exposed | `staging` not exposed in Data API (runbook §4) |
| `insert … violates foreign key … sources` / `products` | Reference rows missing in `public.sources` / `public.products` |
| `permission denied for table …` with service key | Migration 0019 not applied on a fresh project |
| Review API exits on start | `NODE_ENV=production` without `CORS_ORIGIN` |
| Admin Panel CORS error | API `CORS_ORIGIN` does not include the panel origin |
| Admin Panel always 401 | Token expired (no refresh), wrong `VITE_SUPABASE_URL`, or API cannot fetch JWKS |
| Actions return 403 | User lacks `app_metadata.role` reviewer/admin |
| Approve returns 500 | Invalid state transition (thrown as generic error) |
| Activity never appears in `--preview` | Not `promoted`; `venue_resolution_status` not matched/proposed_new; `matched` without human decision; no future occurrence and no valid recurrence; malformed `occurrences` (see logs) |
| CLI does nothing when imported from a test | Entry-point guards compare `import.meta.url` with `process.argv[1]` (Windows path handling) |
