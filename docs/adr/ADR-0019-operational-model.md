# ADR-0019 — Operational Model como Camada Canónica da Vivere Platform

**Status:** Aceito
**Data:** 2026-07-08
**Decisores:** Eduardo Menezes
**Depende de:** ADR-0006 (Caminho A/B)

---

## Contexto

A Vivere Platform produz dados curados, resolvidos e auditáveis através de um
pipeline de múltiplas etapas (ingestão → curadoria → entity resolution → publicação).
Com a chegada do Publishing Engine (Fase 8), é necessário formalizar qual camada
de dados é canónica para os consumidores da plataforma.

Sem esta formalização, consumidores futuros (API pública, website, analytics,
parceiros) poderiam aceder directamente a `staging.*` — violando a separação
de responsabilidades e expondo dados ainda não curados.

---

## Decisão

**`public.*` é o Operational Model — a camada canónica da Vivere Platform.**

O Publishing Engine publica para o Operational Model.
Todos os consumidores lêem exclusivamente do Operational Model.
Nenhum consumidor acede directamente a `staging.*`.

---

## As três camadas formalizadas

| Camada | Schema | Responsabilidade | Quem acede |
|---|---|---|---|
| A — Raw | `staging.raw_*` | Dado bruto, append-only, imutável | Engine (INSERT apenas) |
| B — Staging / Curadoria | `staging.venues_staging`, `staging.activities_staging` | Curadoria humana + Entity Resolution | Engine + Admin Panel |
| C — Operational Model | `public.venues`, `public.activities` | Dados canónicos publicados e curados | **Todos os consumidores** |

---

## Invariantes arquitecturais

**Invariante 1:** O Publishing Engine é o único componente autorizado a escrever
em `public.venues` e `public.activities` (excluindo registos legacy e operações
manuais de manutenção devidamente documentadas).

**Invariante 2:** Nenhum consumidor externo (app mobile, website, API pública,
analytics, parceiros) acede a `staging.*`. Esta restrição é aplicada via RLS
no Supabase — o role do consumidor não tem permissão em `staging.*`.

**Invariante 3:** O Publishing Engine é completamente desacoplado do app mobile.
O app é apenas um dos consumidores do Operational Model — não o único nem o
mais importante. A arquitectura não é centrada no app; é centrada nos dados.

**Invariante 4 — Publicação Determinística:** múltiplas execuções consecutivas
do Publishing Engine sobre o mesmo estado de staging produzem exactamente o
mesmo estado em `public.*` — sem duplicações, sem updates desnecessários,
sem eventos redundantes. Zero writes → zero eventos.

---

## Consumidores actuais e futuros do Operational Model

| Consumidor | Estado | Lê de |
|---|---|---|
| App mobile Vivere 60+ | Actual (schema existente) | `public.venues`, `public.activities` |
| Admin Panel | Actual (via Review API) | `staging.*` (curadoria) + `public.*` (stats) |
| Website Vivere | Futuro (Fase 10+) | `public.*` |
| API Pública | Futuro (Fase 10+) | `public.*` |
| Analytics | Futuro (Fase 9+) | `public.*` + `public.publication_runs` |
| Parceiros / Prefeituras | Futuro | `public.*` (subset via API) |
| Scheduler | Futuro (Fase 9) | Aciona Publishing Engine |

---

## O que este ADR não decide

- A estrutura exacta de `public.venues` e `public.activities` — isso é decidido
  nos ADR-0015 e ADR-0018 (campos da engine, campos preservados do app).
- Quando o Caminho B (convergência de schema) será executado — isso é o ADR-0015.
- A política de arquivação — isso é o ADR-0016.

---

## Consequências

- O Publishing Engine (Fase 8) é o componente que materializa este ADR
- As migrations 0012–0015 adicionam os campos necessários ao Operational Model
- O RLS do Supabase deve ser configurado para bloquear `staging.*` do role do app
- A documentação de integração para parceiros futuros deve referenciar apenas `public.*`
- Qualquer componente que leia de `staging.*` deve ser considerado interno à engine
