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

## SEC-I — Tracked environment files and local secrets (Medium)

- **Current:** `.env` is git-ignored (not tracked, verified from the git index). `admin-panel/.env.development`
  and `admin-panel/.env.production` **are tracked** in git (added before the `**/.env.*` ignore rule).
  They contain a Supabase URL, an API URL and a key (development: JWT `role=anon`, public by design;
  production: non-JWT value of unidentified type — **To be confirmed**). The local root `.env` contains
  a **production** service_role key (project ref matches the production ref in the runbook), a Google
  API key, an unused `SUPABASE_JWT_SECRET`, and the security-harness credentials; `.env.example`
  instructs to use the project's **real admin account** for the admin harness credentials.
- **Risk:** low for the tracked files (anon key is public); high impact if the local `.env` leaks
  (full DB access + admin login). Reusing the real admin password in a dev file increases blast radius.
  Whether secrets were ever committed in git history was **not verified** (history objects not inspected).
- **Recommendation:** `git rm --cached` the two admin-panel env files (owner decision); remove
  `SUPABASE_JWT_SECRET` if unused; use a dedicated admin test account; run a secret scan over git history
  (e.g. gitleaks) before sharing the repository with a new developer; give the new developer **staging**
  credentials only.

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

## SEC-O — Local development wired to production (High)

- **Current:** the maintainer's `.env` (service_role) and the tracked `admin-panel/.env.development`
  target the production Supabase project.
- **Risk:** running tests/integration scripts, a local Review API, or AI Discovery experiments writes
  to the production database; a new developer copying these files inherits production access.
  The 2026-10-02 incident (`docs/incidents/`) shows accidental production deletes have already happened
  and there are no backups on the current plan.
- **Recommendation:** provision a staging project before onboarding; point dev env files at it; never
  hand production keys to the AI Discovery developer.

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

- Remote: `github.com/menezeed/vivere-engine` (from `.git/config`). Visibility (public/private) **To be confirmed**.
- No CI workflow files were found in the repository (no `.github/` path in the working tree listing nor in the git index) — tests are not enforced on PRs (**To be confirmed** against GitHub settings).
- `docs/engineering/ai-development-workflow.md` describes AI agents working through GitHub issues/PRs; any automation with repository write access must not receive Supabase service keys or Google/LLM API keys unless explicitly decided.
