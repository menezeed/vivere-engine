# ADR-0023 — Activity Discovery V1 Freeze Boundary

**Status:** Aceito
**Data:** 2026-10-01
**Decisores:** Eduardo Menezes

---

## Contexto

As Activities 11–13 auditaram, com dados reais, o comportamento do
Activity Discovery — extracção estruturada e narrativa, detecção de
recorrência, e o limite de segurança entre Discovery e Publishing. A
Activity 13 fechou dois resultados centrais:

1. **Containment, não perfeição do parser**: o mecanismo de segurança do
   Discovery V1 não é produzir candidatos perfeitos — é garantir que
   nenhum candidato chega a `public.activities` sem decisão humana
   explícita sobre o seu conteúdo. O commit `881c1cd` tornou
   `proposal_status='promoted'` obrigatório para elegibilidade de
   publicação de Activities, independentemente da resolução de venue.

2. **Classes heterogéneas de falso positivo remanescentes**: tentativas
   de eliminar todos os falsos positivos de recorrência narrativa através
   de heurísticas cada vez mais específicas do *parser* foram
   explicitamente rejeitadas (Activity 13, "Option D" e "Model P") — as
   classes restantes (intervalos de dia da semana, multi-data com dia no
   plural, ambiguidade duração-vs-frequência) são linguisticamente
   distintas, não uma única causa raiz corrigível.

Este ADR regista formalmente a decisão de **congelar** o contrato do
Activity Discovery V1 nesse ponto, em vez de continuar a persegui-lo até
zero falsos positivos.

---

## Decisão

**Activity Discovery V1 está congelado** a partir do checkpoint
`main @ 6fece87` (Human Review Publication Gate: `881c1cd`; Discovery
Hardening: `6fece87`).

### Componentes abrangidos pelo *freeze*

```
Source collection (Collectors)
  → Structured/Narrative Parsing
  → Recurrence Detection
  → Raw/Staging contract (schema actual de activities_staging)
  → Entity Resolution handoff (venue_resolution_status como contrato)
  → Human Review handoff (proposal_status como contrato)
```

Publishing **não é redefinido por este ADR** — já tem contrato próprio
(ADR-0018, ADR-0020), fechado independentemente em `881c1cd`.

### Invariante de segurança (confirmado por código, não hipótese)

```
Activity Discovery produz PROPOSTAS.
Discovery output NÃO é autorização de publicação.

Para Activities geridas pelo Engine, elegibilidade de Publishing exige:
  proposal_status = 'promoted'
  E venue_resolution_status elegível ('matched' ou 'proposed_new')

Resolução de venue, SOZINHA, nunca autoriza publicação de conteúdo de Activity.
```

Confirmado por execução real do `--preview` de Publishing (Activity 13):
0 actividades elegíveis contra 19 que seriam elegíveis só por resolução
de venue, antes da correcção.

### Mudanças permitidas após o *freeze*

- Correcção de *bug* P0/P1 (ex: F8/F9/F10, Activity 13)
- Correcção de segurança (ex: `881c1cd`)
- Nova configuração de fonte que siga um contrato já validado (ex:
  adicionar uma nova prefeitura WordPress usando o mesmo
  `WordPressContentCollector`)
- Melhorias de observabilidade que não alterem semântica

### Mudanças que exigem revisão arquitectural explícita (V2/ADR)

- Nova semântica de recorrência (ex: implementar `daily`/`biweekly`/
  `monthly` de facto — ver secção "Limitações Conhecidas", item 7)
- Expansão de *schema*
- Aprovação ou promoção automática de Activity (contradiria directamente
  o invariante "Promotion nunca é automática")
- Mudança de modelo de identidade (`deriveEngineActivityId`,
  `activityIdentity.ts`)
- Modelo de ocorrências de recorrência materializadas
- Qualquer mudança que enfraqueça o *containment* de Human Review

---

## Limitações Conhecidas do Discovery V1

Lista autoritativa e fechada, consolidada da Activity 13. Todas são
**contidas por Human Review** — nenhuma permite que um falso positivo
chegue a `public.activities` sem decisão humana.

### 1. Ambiguidade ordinal / dia da semana
**Tipo:** Parser. **Impacto de segurança:** baixo-médio (1 caso real
confirmado — "Feirão de Empregabilidade", "segunda edição"). **Contido
por Human Review:** sim. **V1 Blocker:** não. **Backlog:** Discovery V2.

### 2. Multi-data + dia da semana no plural
**Tipo:** Parser. **Impacto de segurança:** médio (1 caso real
confirmado — "A Cartomante", duas datas partilhando "quartas-feiras").
**Contido por Human Review:** sim. **V1 Blocker:** não. **Backlog:**
Discovery V2.

### 3. Intervalos de dia da semana ("de segunda a sexta-feira")
**Tipo:** Parser. **Impacto de segurança:** alto — padrão **dominante**
dos falsos positivos remanescentes (3 de 6 no corpus auditado da
Activity 13). **Contido por Human Review:** sim. **V1 Blocker:** não.
**Backlog:** Discovery V2.

### 4. Ambiguidade duração-vs-frequência ("todo o domingo")
**Tipo:** Parser. **Impacto de segurança:** baixo-médio (1 caso real
confirmado — "32ª Cavalgada da Independência"; correcção desenhada mas
deliberadamente não implementada nesta ronda). **Contido por Human
Review:** sim. **V1 Blocker:** não. **Backlog:** Discovery V2.

### 5. Sem sinal dedicado de "recorrência não suportada"
**Tipo:** Observability / Review UX. **Impacto de segurança:** nenhum —
não afecta elegibilidade de publicação, só a eficiência do revisor
humano (que vê `recurrence_type=null` sem distinguir "nenhuma recorrência
no texto" de "recorrência presente, gramática não suportada"). **Contido
por Human Review:** n/a (não é um risco de publicação). **V1 Blocker:**
não. **Backlog:** Observability / Review UX, Activity 18.

### 6. Carga de revisão multi-fonte não estabelecida
**Tipo:** Operations. **Impacto de segurança:** nenhum directo — o *gate*
é incondicional, não depende de volume. **Contido por Human Review:**
sim (por desenho, independente de volume). **V1 Blocker:** não.
**Backlog:** Activity 18, monitorização operacional.

### 7. Tipos de recorrência declarados mas não produzidos
**Tipo:** Parser / Contract gap. `daily`, `biweekly`, `monthly` existem
no contrato de domínio (`RecurrenceType`) mas nenhum caminho de código do
detector de Discovery V1 os produz — ver ADR-0018, secção "Revisão
2026-10-01". **Impacto de segurança:** nenhum (nunca produzidos, logo
nunca publicados incorrectamente). **Contido por Human Review:** n/a.
**V1 Blocker:** não. **Backlog:** Discovery V2, se algum dia necessário.

---

## Baseline de Auditoria Real — Activity 13

**Fonte:** São Pedro da Aldeia. **Janela:** 30 dias. **Estratégia:**
Strategy D (sem filtro de categoria).

```
Posts auditados:              160
Itens com recorrência estruturada: 10
Confirmados genuínos:          2/10
Confirmados falsos positivos:  6/10
Ambíguos:                      2/10
Carga de revisão observada:    8/10 itens exigindo atenção humana
```

**Estas medições NÃO devem ser extrapoladas** para Cabo Frio nem para
fontes futuras — são específicas a esta fonte, esta janela, esta
estratégia.

Para as Activities 11 e 12, apenas achados qualitativos foram registados
(F1, F2, F3, F4) — nenhum *baseline* numérico quantitativo equivalente
existe para essas Activities. Estado: **NOT RECOVERABLE FROM CURRENT
EVIDENCE** para métricas quantitativas de Cabo Frio.

---

## Trabalho Diferido para Activity 18 (Observability / Failure Handling)

- Medição de carga de Human Review multi-fonte
- Métricas operacionais de falsos positivos de recorrência
- Possível sinal dedicado de "recorrência não suportada" (item 5 acima)

Melhorias ao próprio *parser* permanecem *backlog* de Discovery V2, onde
aplicável — não fazem parte do trabalho de Activity 18.

---

## Consequências

- Nenhuma nova regra de *parser* de recorrência é implementada sem
  evidência de que resolve uma classe real, sem reabrir heurísticas
  rejeitadas (ver Activity 13, "Option D", "Model P").
- Novas fontes WordPress podem ser adicionadas livremente, desde que
  sigam o `WordPressContentCollector` existente — não exigem revisão
  arquitectural, só a configuração de fonte (`config/<fonte>.ts`).
- Qualquer proposta de aprovação automática, nova semântica de
  recorrência, ou enfraquecimento do *gate* de Human Review exige um
  novo ADR explícito, nunca uma mudança incremental ad-hoc.
