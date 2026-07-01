# ADR-0005 — Defaults universais + configuração por produto no Venue Filtering Engine

**Status:** Aceito
**Data:** 2026-06 (Fase 2)
**Decisores:** Eduardo Menezes

---

## Contexto

Ao generalizar o Venue Filtering Engine (terceiro e último componente da engine a ser generalizado), surgiu a questão de como tratar regras que são "óbvias para qualquer produto" (rejeitar banco, aceitar museu) versus regras específicas de público-alvo (vocabulário de idoso, quarta categoria de ambiguidade `likely_fitness_generic`).

## Decisão

**Duas camadas de regras, nunca misturadas no mesmo arquivo:**

1. **Defaults universais** (`defaultRules.ts`) — características gerais de lugar físico, válidas para qualquer produto Vivere. Todo produto herda automaticamente. Ex: rejeitar `bank`/`gas_station`/`shopping_mall`/`supermarket`; aceitar `museum`/`performing_arts_theater`/`library`/`cultural_center`/`park`.

2. **Configuração por produto** (`products/<produto>.ts`) — vocabulário de público-alvo, quarta categoria de ambiguidade, regras de revisão próprias. Cada produto declara as suas; não há default universal sensato para nenhuma delas.

Mecanismo de composição: `extend` (soma às universais) ou `override` (substitui por completo), declarado explicitamente por categoria, nunca implícito.

Tipagem: `VenueFilterRuleSet<TRuleId extends string, TAmbiguityLabel extends string>` — generics duplos preservam segurança de tipo; erro de digitação ou mistura de vocabulário entre produtos é detectado em tempo de compilação. `rule_id` não é `string` livre por decisão explícita.

## Consequências

- `likely_fitness_generic` deixou de ser literal fixo no union type do motor — passou a ser `ambiguity_fallback.label` configurado pelo produto
- `ruleLists.ts` foi removido; seu conteúdo foi distribuído entre `defaultRules.ts` (regras universais) e `products/vivere-60-mais.ts` (regras específicas do Vivere 60+)
- Prova mecânica de isolamento: produto sintético de turismo (`lodging` → `likely_generic_lodging`) processa o mesmo item sem nunca produzir `likely_fitness_generic`
- **Ressalva registrada na revisão arquitetural:** esta foi a única das três generalizações da Fase 2 que não nasceu de uma dor concreta já observada em dado real — foi generalização especulativa. Válida e funcional, mas o segundo produto real ainda não existe para validar o padrão além do sintético
