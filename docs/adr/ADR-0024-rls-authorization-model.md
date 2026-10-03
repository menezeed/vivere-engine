# ADR-0024 — Modelo de Autorização RLS: `app_metadata.role`

**Status:** Aceito
**Data:** 2026-10-03
**Decisores:** Eduardo Menezes

---

## Contexto

Activity 15/26 (auditoria de segurança) confirmou, por evidência ao vivo,
que as políticas RLS de `public.activities`, `public.venues`,
`public.partners` e `public.categories` concediam `ALL` (SELECT/INSERT/
UPDATE/DELETE) a qualquer sessão com `auth.role() = 'authenticated'` —
isto é, qualquer conta autenticada, independentemente de ter qualquer
papel administrativo real. Qualquer utilizador que criasse conta via
`supabase.auth.signUp()` (já em uso real pelo app móvel) obtinha,
imediatamente, controlo total sobre estas quatro tabelas.

## Decisão

A autorização privilegiada passa a exigir `app_metadata.role = 'admin'`
no JWT — nunca apenas `auth.role() = 'authenticated'`. `app_metadata` só
pode ser escrito por `service_role`, nunca pelo próprio utilizador, o
que o torna seguro como base para controlo de acesso (ao contrário de
`user_metadata`, editável pelo utilizador).

Este mecanismo já existia parcialmente — o Admin Panel actual já lia
`app_metadata.role` para decidir `canReview`/`isAdmin` no *frontend*
(`admin-panel/src/auth/authClient.ts`, `types/review.ts`). Esta decisão
estende o mesmo mecanismo à base de dados, fechando a lacuna entre o
que o *frontend* já assumia e o que a RLS realmente impunha.

### Compatibilidade — `interested_count`

O app móvel (instalado, em produção) actualiza `public.activities.
interested_count` com um `UPDATE` directo, para utilizadores autenticados
e anónimos. Em vez de forçar uma actualização de app antes de poder
corrigir a autorização, foi adicionado um *trigger* `BEFORE UPDATE`
(`guard_activities_update`) que permite esta única coluna, dentro de
limites estreitos (variação de exactamente ±1, nunca `NULL`, nunca
negativo), para qualquer sessão `anon`/`authenticated` — e bloqueia
qualquer outra alteração de coluna, comparando `OLD`/`NEW` como `jsonb`
(protecção automática contra colunas futuras, sem enumeração manual).
Uma RPC `increment_activity_interest` atómica foi criada em paralelo,
como caminho preferido para uma futura migração do app móvel (fora do
âmbito desta correcção).

## Consequências

- `venues`, `partners`, `categories`: sem caminho de compatibilidade —
  escrita fechada a não-admin, sem excepção.
- `staging.*`: confirmado já correctamente restrito a `service_role`
  apenas, sem alteração necessária.
- Engine e `review-api` usam `SUPABASE_SERVICE_KEY` (role `service_role`,
  sempre ignora RLS) — inalterados por esta correcção.

## Validação

Confirmado por execução real contra o Supabase ao vivo (`scripts/
security-rls-validation.ts`, commit `65b528b`), usando identidades reais
(`anon`, conta `authenticated` dedicada sem papel, conta `admin` com
`app_metadata.role='admin'` confirmado) via PostgREST — nunca simulação
no SQL Editor. 16/16 casos validados: `anon`/`authenticated` comuns
confinados a `interested_count` dentro dos limites definidos, sem acesso
a nenhuma outra coluna ou tabela protegida; `admin` com acesso total
preservado; nenhuma das 47 activities `legacy` nem nenhum dado real
tocado pela validação.
