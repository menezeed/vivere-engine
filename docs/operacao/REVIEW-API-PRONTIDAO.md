# Review API + Admin Panel do engine: prontidão para a produção (21/11/2026)

Análise só de leitura sobre o commit `948eff4`. Não houve deploy nem nenhuma alteração.

## Bloqueios concretos
| # | Bloqueio | Prova | Consequência |
|---|---|---|---|
| B1 | **O servidor recusa a produção por desenho (SEC-O fase 2A).** `getSupabaseClient()` chama `assertEnvironment()`, que exige `VIVERE_ENV=staging` e o `SUPABASE_URL` exacto do staging, e lança `PRODUCTION_BLOCKED` mesmo com `VIVERE_PRODUCTION_CONFIRM`. Também recusa uma chave JWT que refira o projecto de produção | `src/persistence/client/supabase.ts` l.9–14; `src/lib/envGuard.ts` l.16–17, 88–134 | Um deploy da Review API **contra a produção não arranca**. Só é possível mudando o guard, o que é uma decisão de arquitectura de segurança, não de deploy |
| B2 | **O Admin Panel recusa chaves da produção no build** (`PRODUCTION_BLOCKED` no `viteEnvGuard`) | `admin-panel/config/viteEnvGuard.ts` l.98–114 | O painel só se constrói para o staging |
| B3 | **SEC-B só aceita JWT de utilizador ES256/RS256 via JWKS** (HS256 recusado). Se o projecto-alvo ainda assinar as sessões com o legacy JWT secret (HS256), **todos os pedidos dão 401** | `src/review-api/middleware/jwtVerifier.ts` l.8–11, 24 | Pré-requisito: signing keys assimétricas no projecto-alvo (P0-5 passo 4, sem downtime). A confirmar com `GET /auth/v1/.well-known/jwks.json` (público) |
| B4 | **SEC-A exige `app_metadata.role` ∈ {viewer, reviewer, admin}** nas contas de revisão | `src/review-api/middleware/auth.ts` l.81–101 | Atribuir papéis (E8) é uma escrita no Auth do projecto-alvo e exige autorização própria |
| B5 | **Sem alojamento nem processo de arranque**: não há host, DNS (`admin.vivere.com.br` e `api.admin.vivere.com.br` não resolvem), script `start` nem `CORS_ORIGIN` definido | `package.json`; DNS 21/11 | Escolher o host (custo) e o domínio |

## Leitura
- No desenho actual, a Review API e o Admin Panel são **ferramentas de curadoria do staging**. A recomendação SEC-I já dizia "redeploy … against staging".
- O conteúdo da produção é gerido hoje pelo **admin do GitHub Pages**, com o login do utilizador e o RLS da produção.
- As tabelas que a Review API usa (`staging.*`, `venue_resolution_*`) **existem na produção** e têm dados (por exemplo 494 `venues_staging`, 24 `ingestion_runs`; contagens do A1). Algum pipeline já correu contra a produção antes dos guards. Não bloqueia; fica registado.

## Decisão de produto (não bloqueia a W2)
- (a) Manter a Review API **só no staging**, que é o desenho actual. O primeiro deploy é no staging (B3–B5 aplicados ao staging) e a produção continua no admin Pages.
- (b) Levá-la à produção: projecto próprio pós-go-live (redesenho do guard B1/B2 com revisão de segurança, B3, B4, B5).
