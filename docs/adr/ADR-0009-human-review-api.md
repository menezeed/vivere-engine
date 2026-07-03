# ADR-0009 — Human Review API: Serviço Standalone da Vivere Platform

**Status:** Aceito
**Data:** 2026-07-03
**Decisores:** Eduardo Menezes

---

## Contexto

Com 160 venues e 8 atividades em `staging.*` com `proposal_status = pending_review`,
a plataforma precisava de um mecanismo para revisão humana, aprovação, rejeição e
promoção de dados antes de chegarem ao app. A decisão era: integrar ao app existente
ou construir um serviço standalone.

---

## Decisões

### API standalone, não integrada ao app

A Human Review API é um segundo processo Node.js dentro do mesmo repositório
(`vivere-engine`), exposto na porta 3001, completamente desacoplado do app Vivere 60+.
O app nunca acessa a Review API — ele consome apenas dados já promovidos em produção.

### Hono como framework HTTP

Escolhido por compatibilidade nativa com ESM, tipagem TypeScript de primeira classe e
ausência de dependências de tipos separadas (`@types/express`). Sem overhead de
configuração para projetos ESM.

### JWT via Web Crypto API — zero dependências extras

A verificação de JWT usa a Web Crypto API nativa do Node.js 18+, sem bibliotecas
como `jsonwebtoken`. O JWT Secret do Supabase é usado para verificar a assinatura
HMAC-SHA256 dos tokens emitidos pelo Supabase Auth.

### RBAC mínimo com três roles

`viewer` (leitura), `reviewer` (approve/reject), `admin` (promote). Roles armazenadas
em `app_metadata.role` no Supabase Auth — sem tabela extra no banco. Suficiente para
múltiplos revisores com rastreabilidade completa (reviewed_by + reviewed_at).

### Promoção fictícia (Opção A)

A promoção não escreve em `public.venues` nem `public.activities`. Marca
`proposal_status = promoted`, `promoted_at`, e `promoted_venue_id = null` em staging.
A integração real com o schema do app é trabalho futuro (Caminho B, ADR-0006).

### Reutilização máxima da engine

A Review API importa diretamente: `getSupabaseClient()`, `RepositoryFactory`,
`IRepositorySet`, `logger`. Nenhuma duplicação de infraestrutura.

---

## Endpoints implementados

```
GET    /health                         — sem auth
GET    /api/venues                     — viewer+
GET    /api/venues/:id                 — viewer+
PATCH  /api/venues/:id/approve         — reviewer+
PATCH  /api/venues/:id/reject          — reviewer+
PATCH  /api/venues/:id/promote         — admin only
GET    /api/activities                 — viewer+
GET    /api/activities/:id             — viewer+
PATCH  /api/activities/:id/approve     — reviewer+
PATCH  /api/activities/:id/reject      — reviewer+
PATCH  /api/activities/:id/promote     — admin only
GET    /api/ingestion-runs             — viewer+
GET    /api/stats                      — viewer+
```

---

## Transições de status permitidas

```
pending_review → approved   (reviewer, admin)
pending_review → rejected   (reviewer, admin)
approved       → promoted   (admin only)
approved       → rejected   (reviewer, admin)
rejected       → [terminal]
promoted       → [terminal]
```

---

## Validado em execução real

- Servidor iniciado: `npx tsx --env-file=.env src/review-api/server.ts`
- Health check: `GET /health` → `{"status":"ok"}`
- Auth middleware: `GET /api/venues` sem token → `401 Token de autenticação ausente`
- 130 testes unitários passando

---

## O que NÃO foi implementado nesta fase

- Login/criação de usuário no Supabase Auth (próximo passo)
- Teste end-to-end com JWT real
- Entity Resolution
- Promoção real para `public.venues` (Caminho B — futuro)
- Painel Admin web (frontend — fase futura)
