# Engine Admin como painel do catálogo de produção (Issue #52): Fase 0 (mapa) e Fase 1 (só leitura)

**Data:** 25/11/2026.

**O que este documento NÃO faz:**
- não há deploy, migração, escrita nem alteração na produção;
- nenhum `.env` mudou;
- não há dados de produção copiados.

**Fontes:**
- `vivere-60plus-admin/index.html` (main);
- metadados da auditoria do backup v5 de 23/11 (`prod-auditoria.csv`, `prod-contagens-depois.csv`: ACL, RLS, políticas e contagens; sem dados);
- esquema `public` do staging pelo MCP só de leitura. Tem a mesma cadeia de migrações, confirmada pela secção K da auditoria.

## 0. Mapa (Fase 0)

### 0.1 Projecto efectivo do admin legado
`index.html` l.157: `SUPABASE_URL = https://ccpqngyupukdefaqvzgl.supabase.co` (**produção**). A chave no código é a anon/publishable; o valor não é reproduzido aqui.

### 0.2 Operações do legado (todas por fetch directo a `/rest/v1`, com a anon key + o token do utilizador)
| Tela | Tabela | Leitura | Escrita |
|---|---|---|---|
| Atividades | `activities` (+ `venues` id,name) | `order=created_at.desc` | POST, PATCH `id=eq`, DELETE `id=eq` |
| Locais | `venues` | `order=name.asc` | POST, PATCH, DELETE (valida lat/lng no browser) |
| Parceiros | `partners` | `order=name.asc` | POST, PATCH, DELETE |
| Categorias | `categories` | `order=label_pt.asc` | POST (key, emoji, cor, label_pt, label_en), PATCH (sem key), DELETE |
| Sugestões | `suggestions` | `order=created_at.desc` | PATCH `{status}`, DELETE |
| Utilizadores | view `users` + `favorites(user_id)` | `order=created_at.desc` | — |
| Login | `/auth/v1/token?grant_type=password` | — | — |

**Formulário de atividade (valores por omissão):**
- `title:''`, `description:''`, `category:''`, `venue_id:null`, `schedule:''`;
- `price:0`, `is_free:false`, `is_sponsored:false`;
- `start_date:null` (ao criar, passa a "hoje" se vier vazia), `end_date:null`;
- `recurrence_type:'none'`, `recurrence_days:[]`, `recurrence_time:''`.

**Formulário de local:** `name`, `address`, `category`, `lat`, `lng` (obrigatórias e dentro dos limites).

**Formulário de parceiro:** `name`, `description`, `logo_emoji:'🏢'`, `cor:'#1B6B45'`, `url`, `coupon`, `discount`, `active:true`.

### 0.3 Esquema (`public`, só a parte relevante)
- **`activities`:**
  - `id uuid` (pk); `title text!`; `description`; `category text` (**sem FK para `categories.key`**); `venue_id uuid` → `venues(id)`;
  - `schedule`; `price numeric=0`; `is_free=false`; `imagem_url`; `is_sponsored=false`;
  - `start_date`, `end_date` (timestamptz); `recurrence_type='none'`; `recurrence_days text[]`; `recurrence_time`;
  - `phone`; `url`; `interested_count=0`; `created_at`;
  - colunas do engine: `engine_activity_id` (unique), `source_key!='legacy'`, `product_key!='legacy'`, `engine_status` ∈ {active, archived, draft}, `last_published_at`.
- **`venues`:**
  - `id`; `name!`; `address`; `category`; `lat`, `lng` (double); `website`; `opening_hours`; `image_url`; `phone`; `created_at`;
  - colunas do engine: `engine_venue_id` (unique), `source_key`, `product_key`, `engine_status`, `last_published_at`.
- **`categories`:** `id`; `key` (unique); `emoji!`; `cor!`; `label_pt!`; `label_en!`.
- **`partners`:** `id`; `name!`; `description`; `logo_emoji`; `cor`; `url`; `coupon`; `discount`; `active=true`.
- **`suggestions`:** `id`; `title!`; `location`; `schedule`; `phone`; `email`; `language='pt'`; `status='pending'`; `comment`.
- **View `active_activities`** (`security_invoker`): o que a app mostra.
- **Contagens (23/11):** activities 48, venues 81, categories 9, partners 3, suggestions 11, favorites 61, auth.users 22.

### 0.4 Controlo de acesso em produção (auditoria de 23/11)
- **RLS activo** em activities, venues, categories, partners, suggestions e favorites.
- **Leitura pública** (`SELECT using=true`): activities, venues, categories, partners. **É isto que permite à Fase 1 ler sem nenhum privilégio.**
- **Escrita:** política `admin_role_all` (ALL, `authenticated`, `app_metadata.role = 'admin'`) em activities, venues, categories e partners.
- **Sugestões:** o público só faz INSERT com `status='pending'`.
- **Favoritos:** só o próprio utilizador.
- **ACL de tabela:** `anon`/`authenticated` mantêm DELETE/INSERT/UPDATE/TRUNCATE de tabela em `categories`/`venues`/`partners`/`favorites` (filtrados pelo RLS; a 0032 / PR #49 está por aplicar).

### 0.5 Riscos do modelo actual (a resolver nas Fases 2–4, não aqui)
1. **O browser fala directamente com a produção, com escrita.** A protecção é só o RLS + `app_metadata.role=admin`. Não há auditoria de quem mudou o quê, nem histórico.
2. **DELETE físico sem soft-delete nem confirmação forte** (só `confirm()`). Uma FK (`23503`) impede apagar locais com actividades, mas não actividades.
3. **`activities.category` sem FK:** pode apontar para uma categoria inexistente; a completude (§1.4) sinaliza-o.
4. **Uma só sessão e um só ambiente:** não há forma de ensaiar no staging pela mesma UI.
5. **Nova actividade sem data:** recebe "hoje" em silêncio.

## 1. Fase 1: catálogo de produção SÓ LEITURA (este PR)

### 1.1 Estratégia de ligação (sem privilégios na produção)
- A Review API (servidor) lê a produção com a chave **publishable/anon**, a mesma que a app pública já tem. As políticas de SELECT público (§0.4) bastam.
- **Não há `service_role`**, nem token de utilizador reencaminhado para a produção, nem login na produção.
- O browser só fala com a Review API. Recebe o rótulo `PRODUÇÃO — SOMENTE LEITURA` em todas as respostas.
- **Isolamento da fila de staging:**
  - namespace próprio `/api/catalog/*`;
  - fonte própria (`PostgrestCatalogSource`), que não usa `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` nem `getSupabaseClient()`;
  - o `envGuard` do staging **não foi alterado** e continua a bloquear a produção na fila;
  - testes provam que os pedidos ao catálogo não chamam serviços de staging, e vice-versa.

### 1.2 Configuração (falha fechada; desligado por omissão)
| Variável | Valor |
|---|---|
| `CATALOG_MODE` | `disabled` (omissão) · `fixture` (sintético) · `production-readonly` |
| `CATALOG_PROD_URL` | exactamente `https://ccpqngyupukdefaqvzgl.supabase.co` (recusa o staging e qualquer outro) |
| `CATALOG_PROD_PUBLISHABLE_KEY` | `sb_publishable_…` ou JWT `role=anon` com `ref` de produção. **Recusa** `sb_secret_`, `service_role`, `authenticated` e chaves do staging |
| `CATALOG_PROD_READONLY_ACK` | exactamente `PRODUÇÃO — SOMENTE LEITURA` |

Uma configuração inválida faz a Review API **não arrancar**. Os valores nunca vão para os logs.

### 1.3 Contrato
Autenticação e papel são os da Review API: Bearer da sessão + `app_metadata.role` ∈ viewer/reviewer/admin; viewer+ lê.

**Rotas:**

| Rota | Query / resposta |
|---|---|
| `GET /api/catalog/status` | `{enabled, environment}` |
| `GET /api/catalog/categories` | `{items, environment}` |
| `GET /api/catalog/activities` | query: `page`, `pageSize` (1–100, por omissão 25), `search` (título, sanitizada), `category`, `venue_id` (UUID), `engine_status`, `sort` = `created_at\|title\|start_date`, `order` |
| `GET /api/catalog/activities/:id` | `{data: {...activity, venue:{id,name}, completeness}, environment}` |
| `GET /api/catalog/venues` | query: `page`, `pageSize`, `search` (nome), `category`, `engine_status`, `sort` = `name\|created_at`, `order` |
| `GET /api/catalog/venues/:id` | `{data: {...venue, completeness}, environment}` |

- **Listas:** `{items:[...+completeness], page, pageSize, totalItems, totalPages, environment}`.
- **`environment`:** `{target:'production'|'fixture', access:'read-only', label}`. O label é `PRODUÇÃO — SOMENTE LEITURA` ou `DADOS SINTÉTICOS — SOMENTE LEITURA`.

**Códigos de resposta:**

| Código | Quando |
|---|---|
| 400 | parâmetros inválidos |
| 401 | sem token ou token inválido |
| 403 | sem papel |
| 404 | registo inexistente |
| **405** | **qualquer POST/PUT/PATCH/DELETE**, mesmo admin, sem tocar na fonte |
| 502 | falha da produção (mensagem genérica) |
| **503 `CATALOG_DISABLED`** | catálogo desactivado |

### 1.4 Completude (só informa)
- **Actividade:** `title`, `category`, `category_unknown`, `venue`, `date_or_recurrence` (sem `start_date` e sem recorrência completa), `price_or_free`.
- **Local:** `name`, `address`, `coordinates`, `category`.

### 1.5 Testes focados
**49 novos testes**, sem rede nem base de dados:
- configuração: falha fechada, 13 recusas, chave nunca nas mensagens;
- fonte: só GET, allowlist de colunas, sem token de utilizador, pesquisa sanitizada, validação de UUID e enum, nenhum método de escrita;
- rotas: 401/403, viewer/reviewer/admin, 405 em todas as escritas, 503 desactivado, 400 e 404, 502 genérico;
- isolamento dos dois sentidos.

Suite da Review API: **430/430**. O teste de guarda "nenhuma rota de escrita sem papel" continua intacto: a recusa é por middleware e o catálogo não regista nenhuma rota de escrita.

### 1.6 Rollback
- `CATALOG_MODE=disabled` (a omissão) desliga tudo.
- Reverter o PR não afecta a fila de staging nem o admin legado, que continua a ser a operação da produção até ao corte (Fase 4).

### 1.7 Activação real (NÃO feita; precisa de autorização do PO)
- Definir as 3 variáveis de produção **num processo local**. A chave é pública (já está no bundle da app), mas não deve ser escrita no repositório.
- A primeira leitura real é um GET à produção pela chave anon: **acesso não privilegiado, mas é acesso à produção**, por isso só depois do aval explícito.

### 1.8 Primeira leitura real (autorizada pelo PO a 25/11; só GET)
- **Como:** `PostgrestCatalogSource` deste PR, num processo local, com `resolveCatalogConfig` em `production-readonly` e a chave **anon pública** do próprio admin legado. O valor não foi impresso nem guardado.
- **Pedidos:** um `fetch` de guarda **recusava qualquer método que não fosse GET** e registou cada pedido. Todos foram GET 200:
  - `/rest/v1/categories`;
  - `/rest/v1/activities` (×2: lista e detalhe);
  - `/rest/v1/venues`.

  Depois, mais três GET de verificação (venues e activities ×2).
- **Nenhuma escrita**: 0 INSERT/UPDATE/DELETE, configuração inalterada.

| Item | Resultado |
|---|---|
| Categorias | 9 (= backup de 23/11) |
| Atividades | **48/48** (= backup). `engine_status`: 48 `active`. `source_key`: 47 `legacy`, 1 `prefeitura_cabo_frio`. 48 com local embebido. Detalhe por id OK |
| Completude das atividades | 32 completas; 16 com `price=0` e `is_free=false` (preço/gratuidade por definir); 1 sem categoria |
| **Locais** | **24 visíveis pela chave anon; o backup v5 de 23/11 (00:24Z) contou 81** (contagem do servidor, antes e depois do dump, e no restauro) |
| Locais referenciados pelas atividades | 24, todos visíveis (0 em falta; embed nulo 0) |
| Completude dos locais | 0 completos: os 24 não têm `category` |

**Divergência de locais (81 → 24), por esclarecer pelo PO:**
- **Os 57 locais que não aparecem não são usados por nenhuma actividade.** É precisamente o conjunto que o DELETE do admin legado consegue apagar: a FK impede apagar locais em uso.
- **Hipóteses:**
  - (a) foram apagados depois de 23/11 00:24Z;
  - (b) a política de leitura pública de `venues` mudou (a 23/11 era `SELECT using=true`).
- **A leitura anon não distingue as duas.** Confirmar exige uma leitura privilegiada (Dashboard), que não foi autorizada.
- **Em qualquer dos casos houve uma alteração na produção depois do backup.** O backup v5 de 23/11 contém os 81 e permite recuperá-los, se for esse o caso.

## 2. Frontend (Codex Admin, PR separado sobre esta branch)
- Secção **"Catálogo de produção"** no `admin-panel`, separada da navegação da fila:
  - Atividades e Locais: lista, busca, filtros (categoria, local, `engine_status`), paginação, detalhe e completude;
  - banner fixo com `environment.label`; cor e ícone distintos da fila de staging;
  - **sem botões de escrita**.
- Flag de UI `VITE_CATALOG_ENABLED=false` por omissão; com a flag OFF, a rota não aparece.
- Estados a tratar: 503 `CATALOG_DISABLED` ("desactivado"), 401 → login, 403 → sem permissão, 502 → indisponível, lista vazia.
- Testes com o `CATALOG_MODE=fixture` / mocks do contrato §1.3; nenhum pedido à produção.

## 3. Fases seguintes (planeamento; cada uma precisa de autorização própria)
- **Fase 2, escrita:** identidade de produção separada. O admin da produção **não** pode ser um papel do staging. Opções:
  - (a) o servidor valida o JWT **de produção** do utilizador (JWKS de produção, `role=admin`) e reencaminha-o, para que o RLS continue a decidir;
  - (b) chave de servidor com RBAC próprio + auditoria.

  Recomendação: **(a)**, porque não introduz nenhum segredo novo. Também: auditoria (tabela de eventos), soft-delete via `engine_status=archived` em vez de DELETE, idempotência, paridade com os formulários do §0.2, testes só sintéticos/staging, backup ≤ 24 h + REF Level 2 antes de qualquer escrita.
- **Fase 3:** a publicação da fila de staging no catálogo passa pelo `src/publishing` existente, com diff, confirmação, duplicados e vínculo do local. Aprovar uma proposta ≠ escrever no catálogo.
- **Fase 4:** QA de paridade, corte com rollback, e o legado operacional até ao aceite.
