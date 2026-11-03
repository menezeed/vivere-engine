# 09 — Security and Access

> Read-only analysis. **No changes were made.** No secret values are reproduced here; where local
> files were inspected, only variable names and key *types* (e.g. "JWT with role=anon") are reported.
> Each finding is classified as **Current implementation / Risk / Recommendation**. Recommendations are
> **PROPOSED** and require the owner's decision.

Severity scale used: **High** (data exposure or unauthorized write plausible), **Medium**, **Low**.

---

## SEC-A — Any Supabase Auth user gets `viewer` access to the Review API (High)

- **Current implementation:** `authMiddleware` accepts any valid Supabase JWT and assigns
  `role = app_metadata.role ?? 'viewer'`. Read endpoints (`GET /api/venues`, `/api/activities` incl.
  `raw_payload`, `/api/ingestion-runs`, `/api/stats`, `/api/entity-resolution/*`) have no role check.
  ADR-0024 states the mobile app uses `supabase.auth.signUp()` against the same project.
- **Risk:** any end-user account created via the app (if the Review API URL is reachable) can read all
  unreviewed staging data and raw source payloads, bypassing the staging isolation intended by ADR-0019.
- **Recommendation:** require an explicit role (`viewer|reviewer|admin`) in `app_metadata` and reject
  tokens without it (use the existing but unused `requireRole`); optionally check `aud`/`iss`.

## SEC-B — JWT verification details (Medium)

- **Current:** ES256 via JWKS, **only `keys[0]`** cached for the process lifetime; `kid`, `alg`, `aud`,
  `iss`, `nbf` not checked; payload decoded with `atob` (non-UTF-8 safe).
- **Risk:** key rotation breaks auth until restart; tokens for other audiences of the same project are
  accepted; mismatch with ADR-0009 (HS256) can mislead maintainers.
- **Recommendation:** select key by `kid`, refresh JWKS on unknown `kid`, validate `iss`/`aud`; update ADR-0009 or add a note.

## SEC-C — `service_role` used by every engine process and the HTTP API (Medium)

- **Current:** Engine CLIs and the Review API use `SUPABASE_SERVICE_KEY` (`BYPASSRLS`). 0019 grants
  minimal table privileges, but `service_role` keeps inherited `TRUNCATE` (also on `staging.raw_*`) —
  registered hardening debt in `db/migrations/README.md`.
- **Risk:** if the Review API is reachable from the internet (hosting **To be confirmed**), a bug or
  compromise of it has full access to staging and to `public.venues/activities` (SELECT/INSERT/UPDATE). Append-only of raw tables is not absolute.
- **Recommendation:** decide the debt item (revoke `TRUNCATE`, `TRIGGER`, `REFERENCES`, `MAINTAIN`);
  consider a dedicated Postgres role for the Review API limited to staging tables it needs;
  the future AI Discovery Layer should not receive the service key at all if it can hand items to an
  in-process collector run by the operator.

## SEC-D — Public read of all engine rows in `public.activities` / `public.venues` (Medium)

- **Current:** policies `"Leitura pública de atividades"` / `"… venues"` are `FOR SELECT TO public USING (true)`.
  `active_activities` view does not filter `engine_status` or `product_key`.
- **Risk:** archived/draft engine rows and other products' rows are readable by `anon`. Correct
  visibility depends entirely on the mobile app filtering `engine_status='active'` (ADR-0016) — which is
  **Unknown / To be confirmed** since the app is not in this repo.
- **Recommendation:** confirm app queries; consider restricting the SELECT policy or view to `engine_status='active'`.

## SEC-E — `anon`/`authenticated` UPDATE on `public.activities` (Low, mitigated)

- **Current:** `compat_interested_count_update` allows UPDATE for anon/authenticated; trigger
  `guard_activities_update` (SECURITY DEFINER) allows only ±1 changes to `interested_count`; validated by
  `scripts/security-rls-validation.ts` (16/16 cases, ADR-0024).
- **Risk:** counter manipulation (unbounded ±1 calls) remains possible; `active_activities` grants all
  privileges to anon/authenticated and is flagged "SECURITY VALIDATION REQUIRED BEFORE GO-LIVE".
- **Recommendation:** migrate app to `increment_activity_interest` RPC and drop the compat policy; run
  `scripts/active-activities-security-addendum.ts` evidence review.

## SEC-F — RLS on tables protected only by "RLS on, zero policies" (Low)

- **Current:** `products`, `sources`, `publication_runs`, `publication_events` (0022) and the three ER
  tables (0020) rely on RLS without policies; 0022 notes anon/authenticated **have full table privileges** there.
- **Risk:** a future accidental permissive policy or `DISABLE RLS` exposes them instantly.
- **Recommendation:** also revoke table privileges from anon/authenticated (defence in depth).

## SEC-G — Raw-table policies apply to `PUBLIC` (Low)

- **Current:** 0002 policies `*_allow_insert WITH CHECK (true)` and `*_allow_select USING (true)` have no
  `TO` clause. Protection of `staging.*` from anon depends on schema exposure and table grants (0019
  grants only `service_role`; production default ACL **To be confirmed**).
- **Recommendation:** verify with the catalogue query in the runbook that anon/authenticated have no
  privileges on `staging.*`; scope policies `TO service_role`.

## SEC-H — CORS (Low)

- **Current:** `CORS_ORIGIN` env (single string) in production; refuses to start in production without it;
  localhost list in development.
- **Risk:** low. Note the API uses Bearer tokens (not cookies), so CORS is not the main control.
- **Recommendation:** keep; document the production origin.

## SEC-I — Tracked environment files and local secrets (Medium → partly remediated)

> Updated by SEC-O 2C-0 / 3-001 / 3-002 (2026-10-30/31). Original finding kept in git history.

- **Current:**
  - Only `.env.example` and `admin-panel/.env.example` are tracked. The two admin-panel env files were
    removed from the index in PR #4 (they remain in **public** git history: an anon key, public by design).
  - `.gitignore` covers `.env`, `**/.env.*`, `*.backup`, `keys.txt`, private keys (`*.pem`, `*.key`,
    `*.p12`, `*.pfx`, `id_rsa*`), `*service-account*.json`, `secrets*.json`, `creds*.json`,
    `credentials*.json` and editor backups/temp files.
  - CI runs gitleaks on every PR/push; a versioned local pre-commit hook (`.githooks/pre-commit`,
    `npm run hooks:install`) blocks env/key files and secret-looking values before they are committed.
  - `.env.example` now declares `VIVERE_ENV=staging` and asks for a **dedicated staging test admin**.
  - The root `.env` points at **staging**. Production credentials (`service_role`, JWT secret, admin
    password, Google API key) exist only in a local, git-ignored backup file. **Rotation is pending**
    (owner action; see the 3-001 report).
  - A Google API key was committed in mid-2026 and removed by a history rewrite. It is not reachable from
    any GitHub ref today, but it is still present in local `refs/original` / reflog objects.
- **Risk:** high until the production credentials are rotated (full DB access, token forgery, admin
  login, paid API usage). The repository is **public**, so any new leak is public on push.
- **Recommendation (pending owner):** rotate production credentials (Supabase legacy keys + JWT secret,
  admin password, Google key). Then delete the local backup and expire `refs/original`/reflog. Every
  developer enables the pre-commit hook.

### Credential policy (SEC-O)

1. Development and tests use **only** the staging Supabase project. Code guards enforce this (`SEC-O` below).
2. Production credentials are never placed in `.env`, docs, issues, PRs, chat or CI. They are held by
   the owner only and are used from the Supabase/GCP consoles.
3. Server keys (`sb_secret_…` / `service_role`) are never put in any `VITE_*` variable (the Vite guard
   blocks it) nor shipped to mobile/browser clients.
4. Test accounts are dedicated staging accounts. Never reuse a real admin account or a password used
   elsewhere.
5. A suspected leak is treated as real: rotate first, investigate after.

## SEC-J — Admin Panel token storage (Low)

- **Current:** access token and user object in `localStorage`; no refresh; `ProtectedRoute` checks only presence.
- **Risk:** XSS would expose the token; UI role checks are cosmetic (API enforces).
- **Recommendation:** acceptable for an internal tool if CSP is set by the host (hosting **To be confirmed**).

## SEC-K — Operator CLIs self-assert identity (Low)

- **Current:** `run-review-action.ts` takes `--user-role`; `run-human-resolution.ts` takes `--user-id`.
- **Risk:** audit fields (`reviewed_by`, `user_id`) can be set to any value by whoever holds the service key.
- **Recommendation:** document as operator-only; restrict service key distribution.

## SEC-L — Non-transactional review writes (Medium, integrity)

- **Current:** ER `recordAccept`/`recordProposeNew` do 3–4 sequential writes, later ones without error checks.
  `markPromoted` returns success even when 0 rows changed.
- **Risk:** inconsistent ER state (decision recorded, activity not updated) silently; misleading UI feedback.
- **Recommendation:** move to a Postgres function (single transaction) or check every result.

## SEC-M — Cost controls (Medium, financial)

- **Current:** `budgetGuard` is in-memory per process; `StatsRepository` estimates spend from run counts
  (`USD 0.032/query`, `USD 10/month` constants). Two cost incidents are referenced in
  `docs/ENGINEERING_PRINCIPLES.md` (duplicated `--region` filter).
- **Risk:** an AI Discovery Layer with LLM calls would have no persistent spend cap.
- **Recommendation:** persistent budget store before any paid LLM usage (see `07` §14).

## SEC-O — Local development wired to production (High → mitigated in code)

- **Original finding:** the maintainer's `.env` and the tracked `admin-panel/.env.development` targeted
  the production Supabase project. The 2026-10-02 incident (`docs/incidents/`) showed that accidental
  production deletes had already happened, and there are no backups on the current plan.
- **Current (PRs #3, #4, #5):**
  - `src/lib/envGuard.ts` runs before every Supabase client. It is used by `getSupabaseClient()` (Engine,
    Review API, ER, publishing) and by the two scripts that create clients directly. It accepts only
    `VIVERE_ENV=staging` + the exact staging URL + a valid server key, and blocks production
    unconditionally, before any network call.
  - `admin-panel/config/viteEnvGuard.ts` (called from `vite.config.ts`) blocks `vite` dev/build unless
    the panel points at staging, and rejects privileged keys in any `VITE_*`.
  - Local `admin-panel/.env.*` files that still target production are stopped by the guard
    (`PRODUCTION_BLOCKED`).
- **Residual risk:**
  - Tools outside this code (Supabase CLI, `psql`, ad-hoc scripts) are not guarded.
  - Checkouts of tags or branches older than PR #3 have no guard.
  - A `sb_secret_` key cannot be bound to a project offline, so the guard reports `binding=unverified`.
  - Where the deployed Review API/Admin Panel run, and against which project, is **To be confirmed**.
- **Recommendation:** rotate production credentials (SEC-I). Redeploy the Review API and Admin Panel
  against staging. Never hand production keys to the AI Discovery developer.

## SEC-N — Infrastructure identifiers in docs (Info)

- **Current:** `docs/runbooks/staging-bootstrap.md` contains Supabase project refs (not secrets) and a
  local Windows path for a key-identity helper.
- **Recommendation:** acceptable; avoid adding keys or passwords to docs.

---

## Privilege boundaries (summary)

| Actor | Credential | Can read | Can write |
|---|---|---|---|
| Engine CLIs | service_role key | everything | staging (+ public via publishing) |
| Review API | service_role key | everything | staging tables (review, ER) |
| Admin Panel user | Supabase user JWT → Review API | staging via API (any authenticated user, SEC-A) | review transitions by role |
| Mobile app (anon/authenticated) | anon key + optional user JWT | public tables per RLS (incl. non-active engine rows, SEC-D) | `interested_count` (guarded), own favorites/interests, suggestions |
| Supabase admin (`app_metadata.role='admin'`) via PostgREST | user JWT | public tables | ALL on activities, venues, categories, partners |
| **Future AI Discovery Layer (PROPOSED)** | none of its own for DB; LLM provider key | source content | **nothing in DB directly** — hands `RawActivityItem[]` to the orchestrator |

## GitHub / secrets considerations

- Remote: `github.com/menezeed/vivere-engine`. The repository is **public** (verified 2026-10-30): never
  commit secrets, and treat anything pushed as published.
- CI: `.github/workflows/ci.yml` runs Engine typecheck + tests, Admin Panel typecheck and a gitleaks
  secret scan on every PR and push to `main`. Branch protection (required checks) is **To be confirmed**
  in GitHub settings.
- Local: `.githooks/pre-commit` (enable with `npm run hooks:install`) blocks secrets before they are
  committed, with or without a local gitleaks install (see `08` §8a).
- `docs/engineering/ai-development-workflow.md` describes AI agents working through GitHub issues/PRs; any automation with repository write access must not receive Supabase service keys or Google/LLM API keys unless explicitly decided.
