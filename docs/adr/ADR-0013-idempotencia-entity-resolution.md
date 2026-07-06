# ADR-0013 — Política de Idempotência do Entity Resolution Engine

**Status:** Aceito
**Data:** 2026-07-06
**Decisores:** Eduardo Menezes

---

## Contexto

O Entity Resolution Engine pode ser invocado múltiplas vezes para a mesma
actividade — manualmente pelo operador, por scheduler automático, ou após
uma nova ingestão de venues que aumenta o pool de candidatos. Sem uma política
explícita, cada implementação poderia tomar uma decisão diferente sobre o que
acontece a runs e candidatos anteriores, criando inconsistência entre sprints.

Este ADR define a política antes da implementação do EntityResolutionEngine
(Sprint 7.9), conforme exigido pelo roadmap aprovado.

---

## Decisão

### Política: Re-resolve sempre, preserva decisões humanas

O motor adopta a seguinte política de idempotência:

```
Se a actividade já tem candidatos de uma run anterior mas SEM decisão humana:
  → Apaga os candidatos anteriores
  → Gera novos candidatos com o pool actual
  → Persiste os novos candidatos
  → Actualiza venue_resolution_status para o novo resultado

Se a actividade já tem uma decisão humana registada (decision_outcome = accepted):
  → NÃO reprocessa
  → Retorna o resultado anterior como SuccessResult
  → Loga aviso: "Actividade já decidida — ignorando"

Se a actividade está em estado 'matched' ou 'proposed_new' (decidida):
  → NÃO reprocessa (protege o trabalho do revisor)
  → Para forçar re-resolução, o Admin Panel deve expor uma acção explícita
    "Re-resolver" que limpa a decisão antes de chamar o motor
```

### Justificação

**Opção A — Criar nova run sem limpar anteriores (rejeitada):** acumula candidatos
obsoletos na DB. Candidatos de runs antigas com pool menor ficam ao lado de
candidatos de runs novas com pool maior — confuso para o revisor e para
queries de observabilidade.

**Opção B — Nunca reprocessar se já existem candidatos (rejeitada):** impede
melhoria dos resultados quando o pool de venues cresce. Se hoje "Museu José de
Dome" não estava no pool (pending_review) e amanhã foi aprovado, a actividade
nunca beneficiaria do novo candidato.

**Opção C — Re-resolve sempre, mesmo após decisão humana (rejeitada):** destruiria
trabalho do revisor. Um operador que confirmou um match e vê o status reverter
para unresolved após uma re-execução do motor perde confiança na plataforma.

**Opção D — Re-resolve se sem decisão, protege se com decisão (escolhida):**
equilíbrio correcto. O motor melhora automaticamente os candidatos enquanto a
decisão humana não foi tomada. Após a decisão, o trabalho do revisor é
protegido. A acção explícita "Re-resolver" no Admin Panel dá controlo total
ao operador sem esconder o comportamento.

---

## Implementação

```typescript
// Em EntityResolutionEngine.resolve()

async resolve(activityId: ActivityStagingId, config?): Promise<ERResult> {
  // 1. Verificar se já existe decisão humana
  const existingDecision = await this.repos.decision.findLatest(activityId);
  if (existingDecision && existingDecision.action !== 'skipped') {
    logger.info({ activityId, existingDecision: existingDecision.action },
      'actividade já decidida — ignorando re-resolução');
    return success(buildResultFromDecision(existingDecision));
  }

  // 2. Limpar candidatos anteriores (sem decisão)
  await this.repos.candidate.deleteByActivity(activityId);

  // 3. Executar pipeline completo
  // ... Generator → PreFilter → Matchers → Hybrid → Classifier

  // 4. Persistir novos candidatos
  // ...
}
```

---

## Novo método necessário no repositório

Esta política requer um método não previsto nas interfaces da Sprint 7.3:

```typescript
// Adicionar a IVenueResolutionCandidateRepository
deleteByActivity(activityId: ActivityStagingId): Promise<number>;
// retorna: número de candidatos apagados (0 se não existiam)
```

Este método deve ser adicionado à interface antes da Sprint 7.4 (implementação
do repositório) e ao Kernel antes do congelamento definitivo.

---

## Comportamento em resolveAll()

```
resolveAll(productKey) processa actividades com venue_resolution_status IN:
  - 'unresolved'   ← principal caso
  - 'ambiguous'    ← re-tenta quando pool cresceu

NÃO processa actividades com:
  - 'matched'      ← decisão tomada, protegida
  - 'proposed_new' ← decisão tomada, protegida
```

O operador pode forçar re-processamento de uma actividade específica via
`resolveMany([activityId])` após limpar manualmente a decisão no Admin Panel.

---

## Consequências

- Sprint 7.4 deve adicionar `deleteByActivity()` às interfaces do repositório
- Sprint 7.9 implementa a lógica de idempotência conforme esta política
- Admin Panel (Sprint 7.12) deve expor a acção "Re-resolver" com `ConfirmDialog`
  (acção destrutiva — apaga decisão humana anterior)
- A política é simples o suficiente para ser explicada ao operador em uma frase:
  "O motor actualiza automaticamente enquanto você não tiver decidido; depois
  da sua decisão, o motor não interfere."
