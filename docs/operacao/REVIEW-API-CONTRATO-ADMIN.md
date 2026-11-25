# Review API: contrato real e consumo seguro pelo Vivere Admin (staging, 25/11/2026)

**Para:** `menezeed/vivere-60plus-admin`, Issue #3 / PR #4 (Fase A, ponto 2).

**Base:**
- código de `integracao/migrations-p0` @ `948eff4`, que contém SEC-A (papel explícito) e SEC-B (JWT assimétrico via JWKS); a `main` ainda não tem o SEC-B (entra com o PR #19);
- leitura do staging `jvtcgomwbfojsttepcfc` pelo MCP só de leitura (contagens) e do JWKS público.

**Sem deploy, migrações, merges nem alterações em nenhum ambiente.**

## 1. Disponibilidade real (25/11)
| Item | Estado | Prova |
|---|---|---|
| Review API alojada (staging ou produção) | **NÃO EXISTE.** Não há host nem URL. Corre só localmente (`npm run review-api`, porta 3001) | PR #48 (B5) |
| `admin.vivere.com.br` / `api.admin.vivere.com.br` | **Não resolvem** (DNS, 25/11) | nslookup |
| Produção | **Bloqueada por desenho:** `assertEnvironment()` exige `VIVERE_ENV=staging` e o URL do staging; senão `PRODUCTION_BLOCKED` | `src/lib/envGuard.ts`; PR #48 (B1) |
| JWT do staging | **Compatível com o SEC-B:** o JWKS público tem 1 chave `EC/ES256` (`use=sig`). Falta confirmar que é a chave **activa** de assinatura das sessões | `GET /auth/v1/.well-known/jwks.json` |
| Contas com papel no staging (SEC-A) | **0 de 3.** Nenhuma tem `app_metadata.role`, por isso **todas as rotas `/api/*` respondem 403** (E8 em falta) | MCP só de leitura, 25/11 |
| Dados no staging | `activities_staging`: 8 `pending_review` + 1 `promoted`; `venues_staging`: 1; `ingestion_runs`: 2 `success` | MCP só de leitura, 25/11 |

**Conclusão:**
- Hoje **não há nenhum endpoint que o Admin possa consumir**.
- A Fase B da #3 só pode começar contra uma instância de staging, depois de:
  - **D1:** alojar a Review API no staging (decisão e custo: PO);
  - **D2:** atribuir papéis a contas de teste do staging (E8: escrita no Auth do staging, com autorização própria);
  - **D3:** definir `CORS_ORIGIN` com a origem exacta do Admin de teste.
- Até lá, o desenvolvimento faz-se com o servidor local ligado ao staging, ou com mocks do contrato abaixo.

## 2. Autenticação e RBAC
**Cadeia, por ordem** (`src/review-api/app.ts`):
1. **CORS:** `CORS_ORIGIN` (string ou lista).
   - Sem ela, com `NODE_ENV=production`, o processo **não arranca**.
   - Em desenvolvimento aceita só `localhost:5173/3000/4173`.
2. **Autenticação** em `/api/*`:
   - `Authorization: Bearer <access_token da sessão Supabase do utilizador>`.
   - **401** quando o token está ausente, é inválido ou expirou (`{error}`).
   - O verificador (`middleware/jwtVerifier.ts`):
     - aceita **só ES256/RS256**, com `kid` obrigatório e o `alg` igual ao da JWK; `none`, HS256 e os restantes são recusados;
     - exige `exp`, `iss` exacto (por omissão `${SUPABASE_URL}/auth/v1`, configurável), `aud` e `role` top-level `authenticated`; o skew é limitado;
     - sem JWKS disponível → 401 (falha fechada).
3. **Papel explícito:** `app_metadata.role` ∈ {`viewer`, `reviewer`, `admin`}.
   - Caso contrário → **403** "Conta sem papel autorizado para o Review API".
   - O `user_metadata` é **ignorado** (o utilizador pode editá-lo).
4. **Leitura:** qualquer papel válido.
5. **Escrita:** papel por rota, verificado à entrada (`MUTATION_ROLE_MATRIX`) **e** outra vez no serviço:

| Acção | viewer | reviewer | admin |
|---|---|---|---|
| GET em todas as rotas | ✅ | ✅ | ✅ |
| `PATCH /api/{venues,activities}/:id/approve` | 403 | ✅ | ✅ |
| `PATCH /api/{venues,activities}/:id/reject` | 403 | ✅ | ✅ |
| `PATCH /api/{venues,activities}/:id/promote` | 403 | 403 | ✅ |
| `PATCH /api/entity-resolution/:activityId/accept` | 403 | ✅ | ✅ |
| `PATCH /api/entity-resolution/:activityId/override` | 403 | ✅ | ✅ |
| `PATCH /api/entity-resolution/:activityId/propose-new` | 403 | 403 | ✅ |

**Acesso à base:** o servidor usa a **chave de serviço do staging**, só do lado do servidor. O Admin **nunca** recebe nem guarda essa chave; envia apenas o token da sessão do utilizador.

## 3. Rotas reais
Formato de erro: `{ "error": "<texto>" }` (o `stats` acrescenta `hint`).

### Sem autenticação
| Rota | Resposta 200 |
|---|---|
| `GET /health` | `{status:"ok", service:"vivere-review-api", version:"0.1.0", env}` |

### Listas: venues e activities
| Rota | Query | Resposta 200 |
|---|---|---|
| `GET /api/venues` | `page`, `pageSize`, `search`, `status`, `product_key`, `city`, `category`, `source`, `geographic_status`, `sort`, `order=asc\|desc` | `{items, page, pageSize, totalItems, totalPages}` |
| `GET /api/activities` | `page`, `pageSize`, `search`, `status`, `product_key`, `venue_resolution`, `source`, `sort`, `order` | idem |

- `page` ≥ 1.
- `pageSize`: de 1 a **100**, por omissão 20.
- Um valor não inteiro → **400** "Parâmetro de paginação inválido".

### Detalhe
| Rota | Resposta 200 | Erros |
|---|---|---|
| `GET /api/venues/:id` | `{data: Venue}` | 404 |
| `GET /api/activities/:id` | `{data: Activity}` | 404 |

### Decisões: venues e activities
| Rota | Corpo | Resposta 200 | Erros |
|---|---|---|---|
| `PATCH /api/{venues,activities}/:id/{approve\|reject\|promote}` | **nenhum** (ignorado) | `{success:true, action}` | 403, 404, **500 (ver G1/G2)** |

Transições permitidas (`proposal_status`):

| De | `approve` | `reject` | `promote` |
|---|---|---|---|
| `pending_review` | → `approved` | → `rejected` | — |
| `approved` | — | → `rejected` | → `promoted` |
| `rejected` | — | — | — |
| `promoted` | — | — | — |

- Uma transição fora desta tabela dá **500** (ver G1).
- **`promote` não publica nada na app.** Marca o registo como `promoted` no `staging.*`, com `promoted_activity_id = null` ("staging only").
- A publicação no catálogo público **não existe** na Review API.

### Execuções de ingestão e estatísticas
| Rota | Query | Resposta 200 | Erros |
|---|---|---|---|
| `GET /api/ingestion-runs` | `limit` (1–100) | `{data, count}` | — |
| `GET /api/stats` | `product_key` **obrigatório** | estatísticas | 400 sem `product_key` |

### Entity resolution
| Rota | Entrada | Resposta 200 | Erros |
|---|---|---|---|
| `GET /api/entity-resolution/health` | query `product_key` **obrigatório** | — | 400 |
| `GET /api/entity-resolution/queue` | query `product_key` obrigatório; `status`; `page`; `pageSize` (20) | — | 400 |
| `GET /api/entity-resolution/stats` | query `product_key` obrigatório | — | 400 |
| `GET /api/entity-resolution/:activityId/candidates` | `activityId` UUID | — | 400 se não for UUID; 404 |
| `PATCH /api/entity-resolution/:activityId/accept` | corpo `{candidateId, notes?}` | — | 400, 403, 404, **413 > 16 KiB** |
| `PATCH /api/entity-resolution/:activityId/override` | corpo `{candidateId, notes}` | — | idem |
| `PATCH /api/entity-resolution/:activityId/propose-new` | corpo `{notes?}` | — | idem |

## 4. Lacunas do contrato (para a Fase B; não corrigidas aqui)
| # | Lacuna | Efeito no Admin | Correcção proposta (PR próprio do engine) |
|---|---|---|---|
| G1 | Uma transição inválida (por exemplo `approve` num `rejected`) lança `Error` genérico, e a rota responde **500**, não 409 | Não se distingue "já decidido por outra pessoa" de uma falha do servidor | `InvalidTransitionError` → **409** |
| G2 | `promote` num registo que não está `approved` não altera nada (`.eq('proposal_status','approved')`), mas responde **200 `success:true`** | Sucesso falso | Verificar as linhas afectadas → 409 |
| G3 | `updateStatus` lê o estado e depois actualiza **sem** condição sobre o estado lido (corrida entre dois revisores) | Decisões simultâneas: a última ganha | `UPDATE … WHERE proposal_status = <lido>`; 0 linhas → 409 |
| G4 | Não há campo de motivo/notas nas decisões de venues e activities | Não há auditoria do porquê | Corpo opcional `{notes}` com tecto, como no ER |
| G5 | Não há endpoint de publicação no catálogo público | O Admin **não pode substituir** o CRUD legado da produção | Decisão de produto (PR #48, opção a/b) |

## 5. Como o Admin deve consumir (requisitos para o PR da Fase B)
1. **URL base por ambiente, falha fechada:**
   - `REVIEW_API_BASE_URL` explícito, sem valor por omissão e **sem fallback** para a produção nem para o `/rest/v1`;
   - sem configuração → a funcionalidade fica desligada e mostra "API não configurada";
   - recusar arrancar se o URL base contiver o ref do projecto de produção.
2. **Feature flag `REVIEW_API_ENABLED=false` por omissão.** O CRUD legado continua intacto enquanto a flag estiver OFF.
3. **Token:**
   - usar o `access_token` da sessão Supabase **do staging**, obtido com o cliente de auth do staging (anon key do staging), e enviá-lo só em `Authorization: Bearer`;
   - não o pôr em URL, query nem logs; não o copiar para `localStorage` próprio (usar o armazenamento da sessão do supabase-js);
   - **nunca** usar a chave de serviço no browser.
4. **Separação de ambientes:** a sessão do Admin actual (produção, CRUD legado) e a do staging são **clientes diferentes**, com chaves de armazenamento diferentes. Um token de produção nunca segue para a Review API do staging, e vice-versa.
5. **Respostas de erro:**
   - **401** → renovar a sessão uma vez; se falhar, ir para o login; **sem retry** em ciclo;
   - **403** → ecrã "sem permissão", sem retry, e esconder as acções que o papel não permite (tabela §2);
   - **404** → registo inexistente: refrescar a lista;
   - **409** (depois de G1–G3) → "já decidido": refrescar;
   - **até lá, um 500 numa decisão = estado desconhecido:** refrescar o detalhe antes de qualquer nova acção;
   - **400/413** → mostrar a mensagem e não reenviar;
   - rede/CORS → "API indisponível", e a flag continua sem afectar o legado.
6. **Fase B1 só de leitura:**
   - só `GET` (listas, detalhe, `stats`, `ingestion-runs`);
   - os `PATCH` ficam fora até G1–G3 estarem resolvidas e o RBAC estar testado com contas viewer/reviewer/admin do staging.
7. **Acções destrutivas, quando entrarem:** confirmação explícita, um pedido de cada vez (sem acções em massa na primeira versão), botão desactivado durante o pedido para não haver duplo envio, e `promote` só para `admin`.
8. **Paginação:** usar `totalPages`; `pageSize` ≤ 100.
9. **CSP/CORS:**
   - o Admin de teste tem de ter uma origem fixa, a pôr em `CORS_ORIGIN`;
   - o GitHub Pages público (`menezeed.github.io`) **não** deve ser origem autorizada enquanto o site público servir o CRUD de produção.

## 6. Mapa de telas do Admin → Review API
| Tela | Durante a transição |
|---|---|
| Atividades (revisão de ingestão) | `GET /api/activities` (+ detalhe), só leitura na B1 |
| Locais (revisão) | `GET /api/venues` (+ detalhe), só leitura na B1 |
| Associação local ↔ atividade | `GET /api/entity-resolution/queue`, `/candidates` (só leitura) |
| Execuções de ingestão / painel | `GET /api/ingestion-runs`, `GET /api/stats?product_key=…` |
| Atividades e locais **publicados**, parceiros, categorias, sugestões, utilizadores | **Ficam no CRUD legado** (não há rota; G5) |

## 7. Decisões e autorizações necessárias (PO)
- **D1:** alojar a Review API no staging (host e custo).
- **D2:** papéis `viewer`/`reviewer`/`admin` em contas **de teste** do staging (escrita no Auth do staging).
- **D3:** a origem do Admin de teste, para o `CORS_ORIGIN`.
- **D4:** autorizar o PR do engine para G1–G3 antes de qualquer escrita pela UI.
