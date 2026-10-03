# Incidente — Eliminação Acidental de Activity Real Durante Teste de Validação RLS

**Data:** 2026-10-02
**Status:** CLOSED — perda aceite pelo Product Owner
**Contexto:** Activity 15/26, Fase 15D (execução da correcção de
segurança P0, SEC-001/SEC-007)

---

## O Que Aconteceu

Durante a validação funcional da correcção de segurança P0 (SEC-001/
SEC-007, Activity 15/26 — substituição da política `admin_all` baseada
em `auth.role()='authenticated'` por uma baseada em
`app_metadata.role='admin'`), foi usado um padrão de teste no SQL Editor do Supabase que simulava
sessões `anon`/`authenticated` via `SET LOCAL ROLE` +
`set_config('request.jwt.claims', ...)`, dentro de blocos
`BEGIN`/`ROLLBACK`, split por mensagens separadas da conversa.

Um teste de `DELETE` (destinado a confirmar que um utilizador
`authenticated` comum seria bloqueado) foi executado numa mensagem
separada do `BEGIN`/`SET LOCAL ROLE` que o devia ter precedido, e seguido
de um `ROLLBACK` também numa mensagem separada. O `DELETE` devolveu a
linha real via `RETURNING`, sem nenhum erro de RLS — confirmando, a
posteriori, que não correu sujeito às restrições pretendidas. O
`ROLLBACK` subsequente não reverteu a operação.

## Impacto

```
Linha eliminada: public.activities
  id: e5a96ee7-8a56-4891-ba59-ba541d2bfb1a
  title: "Bangers and Mashup Bingo"
  product_key: legacy (inferido pela mudança de contagem 48→47)

Baseline anterior: legacy = 48
Baseline actual:   legacy = 47
```

Investigação de impacto relacionado (só leitura, exaustiva):
- `favorites`: nenhuma referência órfã encontrada
- `activity_interests`: nenhuma referência órfã encontrada
- `staging.activities_staging`: nenhum registo com
  `promoted_activity_id` apontando para esta linha — confirma que
  **nunca foi gerida pelo Engine**, era conteúdo legacy puro
- `staging.raw_activity_items`: nenhuma menção ao título encontrada
- `public.publication_events`: nenhuma referência encontrada

**Nenhuma outra perda de dados foi encontrada.**

## Decisão

Eduardo (Product Owner) avaliou as opções de recuperação:
- Point in Time Recovery: **não disponível** (Supabase Free Plan)
- Scheduled Backups: **não disponíveis** (Supabase Free Plan)
- Reconstrução parcial (só `id`+`title`, restantes 22 campos
  desconhecidos): **rejeitada explicitamente** — produziria dados
  inventados, pior do que não ter a linha

**Decisão: aceitar a perda. Não reconstruir, não recuperar, não
substituir.** O baseline `legacy = 47` passa a ser o baseline oficial
daqui em diante.

## Causa Processual

O procedimento de teste assumiu que `BEGIN`/`SET LOCAL ROLE`/
`set_config(...)` executados numa mensagem da conversa continuariam a
aplicar-se a uma instrução `DELETE` executada numa mensagem posterior
separada. Essa suposição nunca foi confirmada antes de ser usada numa
operação potencialmente destructiva.

**O que está demonstrado, factualmente, sem especular sobre a
implementação interna do SQL Editor**: este padrão de teste falhou em
proteger uma operação `DELETE` real contra dados de produção. Isso basta
para o proibir — não é necessário determinar a causa exacta ao nível da
implementação do Supabase.

## Controlos Preventivos Adoptados

1. **Nunca usar dados reais de produção para testes destrutivos** de
   RLS, autorização ou segurança.
2. **Nunca depender de `BEGIN`/`ROLLBACK`/`SET ROLE`/`SET CONFIG`
   executados em execuções separadas** do SQL Editor do Supabase para
   proteger `DML` posterior — proibido neste projecto, independentemente
   da causa raiz exacta.
3. Testes de RLS devem usar a **identidade real** sendo validada —
   `anon`/JWT real de conta de teste/JWT real de admin/`service_role` —
   via pedidos HTTP reais contra PostgREST, nunca simulação dentro do
   editor SQL privilegiado.
4. Qualquer `INSERT`/`UPDATE`/`DELETE` necessário para teste usa sempre
   uma **fixture descartável**, criada especificamente para esse fim —
   nunca uma actividade, venue, ou conteúdo real, de conveniência.
5. Para operações potencialmente destrutivas: preferir ambiente isolado;
   quando produção for inevitável, seguir sempre
   `pre-check → fixture descartável → operação controlada → post-check
   → cleanup explícito` — nunca depender só de *rollback* implícito.
6. Antes de qualquer mudança destrutiva importante futura, considerar
   *snapshot*/*export*/*backup* apropriado.

## Follow-up — Activity 17 (Backup / Recovery)

Este incidente demonstrou que conteúdo legacy sem fonte externa pode
ser hoje **irrecuperável**. Registado como item obrigatório de
Activity 17:
- RPO/RTO
- estratégia de *backup* e retenção
- teste de *restore*
- *runbook* de recuperação
- protecção específica de dados legacy sem proveniência de Engine
- *snapshot*/*export* antes de operações destrutivas
- adequação do plano Supabase actual (Free) para produção

Não executado nesta Actividade — só registado como achado.
