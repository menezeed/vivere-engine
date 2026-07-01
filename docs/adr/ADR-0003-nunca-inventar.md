# ADR-0003 — Nunca inventar: ambiguidade vai para revisão humana, nunca para adivinhação

**Status:** Aceito
**Data:** 2026-06 (Fase 1)
**Decisores:** Eduardo Menezes

---

## Contexto

Durante o desenvolvimento do `WordPressContentCollector`, casos frequentes apareceram onde o texto da fonte era ambíguo: múltiplas datas candidatas sem associação clara, venue não extraível por ausência de preposição reconhecível, sub-evento sem data própria. A alternativa técnica era escolher heuristicamente ("pega a primeira data", "usa o venue do post anterior") para aumentar o volume de itens gerados limpos.

## Decisão

**Quando há ambiguidade real, o sistema sinaliza para revisão humana — nunca resolve por adivinhação.** Um dado errado que parece confiante é pior do que um dado ausente com reason explícito.

Manifestações concretas:
- `narrative_ambiguous` — múltiplas datas, nenhuma decisão automática, item descartado (não gerado)
- `venue_not_extracted_from_narrative` — venue não extraível, item gerado com `venue_mention: null`, `review_reason` registrado
- `schedule_grouping_detected` — formato de agrupamento não suportado, item gerado com aviso
- `needs_review` no Venue Filtering Engine — nenhuma regra reconheceu o venue, vai para revisão por padrão de segurança (nunca `rejected` por padrão)
- Quarta categoria de ambiguidade (`likely_fitness_generic`) — tipo genérico que pode ou não ser relevante, nunca descartado automaticamente

## Consequências

- Taxa de aproveitamento "limpo" de ~36% nas fontes reais validadas — número honesto, não inflado por adivinhação
- Human Review tornou-se componente arquitetural de primeira classe, não funcionalidade opcional
- `raw_payload.review_reasons` em `RawActivityItem` preserva o motivo exato de ambiguidade para auditoria posterior
- O mesmo princípio se estende à Fase 3: `venue_resolution_status: 'ambiguous'` em staging é uma decisão válida e permanente, não um estado temporário a ser resolvido automaticamente
