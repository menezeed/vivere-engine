# ADR-0016 — Política de Arquivação no Operational Model

**Status:** Aceito
**Data:** 2026-07-08
**Decisores:** Eduardo Menezes

---

## Decisão

**Nunca apagar. Sempre arquivar.**

Registos em public.venues e public.activities nunca são apagados.
Quando um venue ou activity deve deixar de ser visível, o campo
`engine_status` é alterado para 'archived'.

### Estados de engine_status

| Valor | Visível no app | Significado |
|---|---|---|
| `active` | Sim | Publicado e disponível |
| `draft` | Não | Publicado internamente, ainda não visível |
| `archived` | Não | Removido da vista pública, dados preservados |

### Gatilhos de arquivação

| Evento | Acção |
|---|---|
| `staging.venues_staging.proposal_status = 'rejected'` | `engine_status = 'archived'` em public.venues |
| Operador arquiva manualmente via Admin Panel (futuro) | `engine_status = 'archived'` |
| Activity com data passada (futuro, Fase 9) | `engine_status = 'archived'` |

### Quem decide arquivar

Na Fase 8: apenas o operador via CLI ou SQL directo.
Na Fase 9: o Scheduler pode arquivar activities expiradas automaticamente.
Nunca automático para venues — sempre decisão humana.

### Dados de utilizador

Quando uma activity é arquivada, os registos em `favorites` e
`activity_interests` são preservados. O app deve filtrar por
`engine_status = 'active'` nas suas queries — não apaga os registos
relacionados do utilizador.
