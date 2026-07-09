# ADR-0014 — Scheduler e Execução Automática da Entity Resolution

**Status:** Aceito
**Data:** 2026-07-08
**Decisores:** Eduardo Menezes

---

## Contexto

O EntityResolutionEngine está operacional e pode ser executado via CLI:

```cmd
npx tsx --env-file=.env src/entity-resolution/run.ts --product-key=vivere-60-mais
```

A questão é: quando e como automatizar esta execução?

Opções consideradas:
- **A)** Cron externo (servidor, GitHub Actions, Supabase Edge Functions)
- **B)** Scheduler interno Node.js (node-cron, setInterval)
- **C)** Execução manual/CLI por enquanto, scheduler na Fase 9
- **D)** Execução automática pós-ingestão (trigger)

---

## Decisão

**Opção C — Execução manual via CLI até o Publishing Engine e a operação estabilizarem.**

O scheduler fica para a Fase 9 (após Publishing Engine).

---

## Justificação

**Razão 1 — Publishing Engine não existe ainda.**
Resolver venues sem publicar os dados no app mobile não gera valor imediato
para o utilizador final. O ciclo completo é:
`ingestão → resolução → review humana → promoção → publicação → app`.
Automatizar apenas a resolução sem ter o Publishing Engine é automatizar
um passo intermédio de uma pipeline incompleta.

**Razão 2 — Pool de venues ainda em crescimento.**
Com apenas 17 venues promoted, muitas actividades ficam `unresolved` por
falta de candidatos — não por limitação do algoritmo. Executar automaticamente
neste estado geraria ruído na fila de revisão humana. A execução manual
permite controlar quando o pool está suficientemente rico.

**Razão 3 — Calibração de thresholds em curso.**
O threshold de 0.85 foi mantido conservador intencionalmente (ADR-0013).
Até acumular 100+ decisões humanas, não há base estatística para automatizar
com confiança. Execução manual permite observar padrões antes de automatizar.

**Razão 4 — Complexidade operacional prematura.**
Um scheduler requer: gestão de erros, retry, alertas, idempotência em
caso de crash, monitorização. Toda essa complexidade operacional é
justificada quando a pipeline estiver completa e validada.

---

## Comportamento actual (Fase 7)

```
Trigger: manual (operador executa CLI)

npx tsx --env-file=.env src/entity-resolution/run.ts --product-key=vivere-60-mais

Frequência recomendada:
  — Após cada ingestão de venues novos
  — Após revisar e promover venues no Admin Panel
  — Antes de sessions de review humana
```

---

## Comportamento futuro (Fase 9)

```
Trigger: automático após ingestão (post-ingestion hook)
         ou cron diário (ex: 02:00 UTC)

Implementação candidata:
  — Supabase Edge Function (trigger em ingestion_runs.status = 'success')
  — ou GitHub Actions com schedule
  — ou node-cron integrado no processo principal

Pré-condições para implementar:
  1. Publishing Engine operacional (Fase 8)
  2. ≥ 100 decisões humanas acumuladas
  3. Threshold calibrado (potencialmente 0.80)
  4. Pool de venues estável (> 100 venues promoted)
```

---

## Consequências

- O motor continua a ser executado manualmente no encerramento da Fase 7
- A documentação operacional (README, Estado Oficial) deve incluir o comando CLI
- O script `run.ts` já suporta `--dry-run` e `--activity-id` para execução controlada
- Esta decisão será revisitada no início da Fase 9
