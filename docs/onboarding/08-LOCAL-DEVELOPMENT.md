# 08 — Local Development

> Derived from `package.json` files, script headers and ADR-0009. Commands marked
> **To be confirmed** were not executed while writing this document.
>
> ⚠ **Cost warning.** Several scripts call the **paid** Google Places API, including the
> `dry-run-google-places.ts` script ("dry run" means *no DB writes*, not *no API calls*). Never run
> `dry-run-google-places.ts`, `ingest-google-places.ts` or `ingest-targeted-venues.ts` without explicit
> authorization from the product owner.
>
> ⚠ **Staging only (SEC-O).** Development and tests use **exclusively the staging Supabase project**.
> This is enforced in code, not only by convention:
> - Engine, Review API and the validation scripts call `assertEnvironment()` (`src/lib/envGuard.ts`)
>   before creating any Supabase client. They require `VIVERE_ENV=staging` and the exact staging
>   `SUPABASE_URL`; production is blocked unconditionally (`PRODUCTION_BLOCKED`), even with
>   `VIVERE_PRODUCTION_CONFIRM`.
> - The Admin Panel runs `assertAdminPanelEnv()` (`admin-panel/config/viteEnvGuard.ts`) from
>   `vite.config.ts`, so `npm run dev` and `npm run build` refuse to start unless every `VITE_*`
>   points at staging and no privileged key is present.
>
> Project refs live in `src/config/environments.ts`. Never ask for or use production credentials for
> local work; see the credential policy in `09-SECURITY-AND-ACCESS.md`.

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
| `VIVERE_ENV` | Everything that touches Supabase | Must be `staging`. Missing → `ENV_MISSING`; `production` → `PRODUCTION_BLOCKED` |
| `SUPABASE_URL` | All DB access, Review API JWKS | Exactly the **staging** URL (`https://<staging-ref>.supabase.co`, no trailing slash) |
| `SUPABASE_SERVICE_KEY` | All DB access (service_role, bypasses RLS) | **Staging** `sb_secret_…` (or legacy `service_role` JWT). Never expose to browsers/mobile |
| `CORS_ORIGIN` | Review API in production | If unset and `NODE_ENV=production`, the API exits; in development it allows `localhost:5173/3000/4173` |
| `GOOGLE_PLACES_API_KEY` | Google Places scripts | Paid |
| `LOG_LEVEL` | optional | default `info` |
| `REVIEW_API_PORT` | optional | default `3001` |
| `NODE_ENV` | optional | default `development` |
| `SUPABASE_ANON_KEY` | security harness only | |
| `SECURITY_TEST_USER_EMAIL`, `SECURITY_TEST_USER_PASSWORD`, `SECURITY_TEST_ADMIN_EMAIL`, `SECURITY_TEST_ADMIN_PASSWORD` | security harness only (`scripts/security-rls-validation.ts`) | Dedicated test accounts |

`SUPABASE_JWT_SECRET` is **not used by any code**; do not add it to `.env`.

The engine does **not** use `dotenv`; pass `--env-file=.env` to `tsx`. Variables already set in the
shell **win** over `--env-file` (Node precedence); the guard checks the effective values, so a
production URL exported in the shell is still blocked.

### Admin Panel — `admin-panel/.env.development` / `.env.production`

Copy `admin-panel/.env.example`. These files are git-ignored; they were tracked until PR #4 and were
removed from the index then (local copies are kept).

| Variable | Notes |
|---|---|
| `VITE_API_BASE_URL` | Review API base URL (local `http://localhost:3001`; deployed: the staging API host) |
| `VITE_SUPABASE_URL` | Exactly the **staging** URL — anything else stops Vite (`URL_NOT_STAGING` / `PRODUCTION_BLOCKED`) |
| `VITE_SUPABASE_ANON_KEY` | **Staging** publishable/anon key. Every `VITE_*` is shipped to the browser: a `sb_secret_` or `service_role` value stops Vite with `PRIVILEGED_KEY_EXPOSED` |

## 4. Run the Review API

```bash
npx tsx --env-file=.env src/review-api/server.ts
# → http://localhost:3001/health
```

There is no npm script for this. Requires `VIVERE_ENV=staging`, `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` of the staging project.

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

- Framework: Vitest 4 (`devDependencies`). Test files live in `__tests__/` folders across `src/`,
  `scripts/` and `admin-panel/config/`. There is no `test` script and no Vitest config file; run from
  the repo root:

```bash
npx vitest run                 # all tests (offline: Supabase client and fetch are mocked)
npx vitest run src/publishing  # one area
```

- Most tests use mocks via `RepositoryFactory.fromObject` and do not need a database. Integration
  scripts (`scripts/validate-*.ts`, `scripts/security-rls-validation.ts`) hit a real Supabase project
  — staging only, enforced by the guard.
- Tests that spawn child processes (`envGuard`, `ingest-wordpress-content`, `pre-commit-hook`) carry
  explicit timeouts; on a slow Windows machine they can take tens of seconds.
- CI (`.github/workflows/ci.yml`) runs on every PR and push to `main`: Engine `tsc --noEmit` +
  `vitest run`, Admin Panel `tsc -b`, and a gitleaks secret scan.

## 8a. Pre-commit secret scan

The repository is **public**: a committed secret is exposed the moment it is pushed, before CI can
flag it. A versioned hook in `.githooks/pre-commit` checks the staged changes locally. Enable it once
per clone:

```bash
npm run hooks:install          # = git config core.hooksPath .githooks
```

| Situation | Behaviour |
|---|---|
| Staged `.env*` (except `.env.example`), `*.backup`, `keys.txt`, `*.pem`/`*.key`/`*.p12`/`*.pfx`, `id_rsa*` — even with `git add -f` | **Blocked** |
| `gitleaks` on `PATH` | Runs `gitleaks git --pre-commit --staged --redact` (or `protect --staged` on older versions) with `.gitleaks.toml`; blocks on findings |
| `gitleaks` not installed | Warns and runs a minimal built-in check on added lines (`sb_secret_…`, JWTs, Google API keys, private-key headers); blocks on findings |

The hook never prints secret values, only file names, and installs nothing. Installing `gitleaks` is
recommended but optional and is the developer's choice: a binary from the official releases page
(`github.com/gitleaks/gitleaks/releases`) or the OS package manager. `git commit --no-verify` skips the hook. Use it only for a confirmed false
positive: the CI scan still runs on the PR.

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
| `[envGuard:ENV_MISSING]` | `VIVERE_ENV=staging` missing from `.env` (older copies of `.env.example` lacked it) |
| `[envGuard:PRODUCTION_BLOCKED]` / `URL_REF_MISMATCH` | `.env` (or a shell variable) points at production or another project — switch to staging |
| `[adminEnvGuard:…]` when starting Vite | `admin-panel/.env.*` not pointing at staging, or a privileged key in a `VITE_*` variable |
| Commit blocked by `pre-commit (SEC-O)` | A forbidden file or a secret-looking value is staged — unstage it; values belong in the ignored `.env` |
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
