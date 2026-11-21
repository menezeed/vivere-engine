# P0-5: chaves JWT legadas (`anon`/`service_role`) da produção. Inventário e plano (21/11/2026, só leitura)

Nenhuma chave foi lida, recuperada ou publicada. Só se viu a **forma** de cada chave (prefixo `eyJ…` = JWT legado; `sb_publishable_` / `sb_secret_` = chaves novas). Referência: documentação Supabase "JWT Signing Keys" (consultada a 21/11).

## 1. Consumidores da produção `ccpqngyupukdefaqvzgl`
| Consumidor | Chave usada hoje | Prova | Quando deixa de depender do legado |
|---|---|---|---|
| **App publicada** (Android/iOS, `c390c92`) | **`anon` JWT legado, hardcoded** em `src/services/supabase.js` | `git show c390c92:src/services/supabase.js` (forma `eyJ…`) | **Só quando quase ninguém usar a versão antiga.** Uma app instalada não muda de chave |
| App nova (W2, `lote3/android-preview`) | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` via `publicEnv` (EAS) | `src/config/publicEnv.js` | Na build W2, se a variável EAS (P0-3) tiver um valor `sb_publishable_…` |
| **Admin em uso** (GitHub Pages, repositório público `vivere-60plus-admin`) | **`anon` JWT legado, hardcoded** em `index.html`. O login do utilizador usa depois o JWT de sessão | `index.html`: `SUPABASE_KEY` com forma `eyJ…` | Quando o `index.html` passar a usar a `sb_publishable_…` (commit + deploy Pages = alteração de produção) |
| Engine: scripts de ingestão/validação | `SUPABASE_SERVICE_KEY`; o código já aceita `sb_secret_` | `scripts/*.ts`; o guard bloqueia a produção | Já não depende: só corre no staging |
| Engine: Review API + Admin Panel | `SUPABASE_SERVICE_KEY` / `VITE_SUPABASE_ANON_KEY`; o guard aceita `sb_*`; o JWT dos utilizadores é verificado por JWKS (SEC-B) | `viteEnvGuard.ts`, `jwtVerifier.ts` | **Não está alojado**: no primeiro deploy, usar logo `sb_secret_`/`sb_publishable_` |
| CI | nenhum | workflows só com `GITHUB_TOKEN` | — |

## 2. Sequência (cada passo na produção com autorização própria do PO)
| # | Passo | Impacto | Reversão |
|---|---|---|---|
| 0 | Dashboard → Settings → API Keys: confirmar que existem `sb_publishable_` e `sb_secret_` da produção; criá-las se faltarem | nenhum: coexistem com as legadas | apagar a chave nova |
| 1 | **P0-3:** a variável EAS `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` com o valor `sb_publishable_…` (não o `anon` JWT) | só a build W2 | voltar ao valor anterior antes da build |
| 2 | **Admin Pages:** trocar a `SUPABASE_KEY` do `index.html` pela `sb_publishable_…` (é pública por natureza) → commit em `main` do `vivere-60plus-admin` → deploy automático | o admin volta a fazer login; smoke S2 | `git revert` → novo deploy |
| 3 | **`service_role` legado:** ver o "last used" no Dashboard. Se não houver uso recente, **desactivar** só o `service_role` legado | nenhum consumidor de produção conhecido | **reactivar** no Dashboard (reversível) |
| 4 | Migrar o JWT secret para signing keys ("Migrate JWT secret") e rodar para ES256 | sem downtime; as sessões continuam válidas | voltar a pôr a chave antiga em standby + rodar |
| 5 | **`anon` legado:** desactivar **só** quando a app antiga estiver residual (mesmo critério da 0027/W3: ≥ 95 % das instalações na versão nova; "last used" em queda) | **desactivar antes disto parte todas as apps instaladas na versão antiga** | reactivar no Dashboard |
| 6 | Revogar o legacy JWT secret (exige o passo 5) | — | mover para standby |

## 3. O que pode ser preparado sem impacto
- No engine: **nada a mudar**. O código já aceita `sb_*` e os guards recusam chaves privilegiadas em `VITE_*`. Não há PR a abrir.
- O passo 2 é uma alteração de produção (deploy Pages). Diff de uma linha, preparado só depois de o PO autorizar e indicar a `sb_publishable_` (Dashboard, sem a colar no chat).

## 4. Decisão do PO (21/11/2026, #46 id 7064918564)
- **P0-5 RECLASSIFICADO.** Na W2, a `anon` legada fica activa (compatibilidade transitória com as apps já distribuídas). A sua revogação passa para a **W3**, com evidência de adopção e autorização própria.
- **Gate da W2:** a build nova usa `sb_publishable_` (verificar no EAS, P0-3).
- **A rotação de credenciais NÃO está concluída.** Nenhuma chave foi desactivada ou rodada, e nenhuma está autorizada.

## 5. Riscos residuais (aceites ou pendentes)
| Risco | Estado | Mitigação / próximo passo |
|---|---|---|
| `anon` legada activa até à W3 | **aceite** (PO) | é pública por natureza; o acesso é limitado pelo RLS e pelas ACL da W1 (auditoria pós-W1 PASS) |
| `service_role` legada activa | **pendente; sem autorização** | não há consumidor de produção conhecido. Proposta: ver o "last used" e desactivar (reversível) com autorização própria |
| Legacy JWT secret (HS256) | pendente | só se revoga depois da `anon` (W3). A migração para signing keys ES256 é opcional antes, sem downtime |
| Admin Pages com a `anon` legada no repositório público | pendente; precisa de autorização específica | trocar pela `sb_publishable_` (diff de 1 linha + deploy Pages). Até lá, o admin funciona |
| Chave Google no `index.html` público do admin | pendente (P0-4) | confirmar a restrição por referrer/API na consola Google |
