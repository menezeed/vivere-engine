# Activity Engine — Discovery 1.2: Perfis de Fonte WordPress

**Status:** Investigação em aberto — não é ADR, não fixa arquitetura
**Depende de:** Discovery 1.1 (proporção de recorrência em São Pedro da Aldeia, ~64% pelos títulos)
**Fontes examinadas:** Cabo Frio (produção, funcionando), São Pedro da Aldeia (3 posts reais analisados)

---

## O que está provado, com evidência real

**O parser narrativo (`narrativeFallbackParser.ts`) está calibrado para o perfil editorial de Cabo Frio e não cobre integralmente uma segunda fonte real (São Pedro da Aldeia).**

Isto não é hipótese — é o resultado direto do dry-run e da leitura de 3 posts completos:

| Post analisado | O que tem | O parser reconhece? |
|---|---|---|
| Feira de Adoção (142791) | "Todas as sextas-feiras, das 10h às 15h" — recorrência semanal explícita | ❌ Nenhum padrão de recorrência existe em `findAllCandidateDates` |
| Painel da Adoção (139789) | "(01/05)" — data no formato dia/mês | ❌ Só reconhece `(dd)` sozinho (ex: "sexta-feira (19)"), não `(dd/mm)` |
| Procissão de São Pedro (142861) | "(29/06)" — mesma limitação, mas post é retrospectivo (evento já ocorrido) | ❌ Mesma limitação de formato; adicionalmente, não deveria gerar Activity de qualquer forma |

Isso já justifica evolução incremental do parser — dois formatos novos de data, confirmados com texto real, não suposição.

## O que NÃO está provado

**Se essas diferenças exigem "perfis editoriais" distintos (arquiteturas separadas por fonte), ou se são só lacunas de cobertura num parser único e extensível.**

Com duas observações (Cabo Frio, São Pedro da Aldeia), várias explicações continuam possíveis — não há evidência suficiente para escolher entre elas.

### Hipóteses, com critério de aceitação explícito

**Hipótese A — Parser único extensível**
O mesmo `findAllCandidateDates()` continua a servir todas as fontes, só ganhando mais padrões de regex ao longo do tempo (`(dd/mm)`, "toda [dia da semana]", etc.), sem nenhuma reestruturação.
*Aceita se:* uma terceira fonte funcionar com pequenas extensões ao parser existente, sem exigir lógica condicional por fonte.

**Hipótese B — Perfis editoriais**
Existem categorias reais e estáveis de estilo editorial (ex: "Structured Editorial" tipo Cabo Frio vs. "Narrative Editorial" tipo São Pedro da Aldeia), e a Activity Engine precisa de uma estratégia de parsing distinta por perfil, não um único parser universal.
*Aceita se:* uma terceira fonte exigir lógica claramente diferente das duas primeiras, não apenas mais padrões na mesma função.

**Hipótese C — Parser específico por fonte**
Cada prefeitura escreve de forma suficientemente distinta que nunca existirão perfis estáveis e reutilizáveis — cada nova fonte exige lógica de extração própria.
*Aceita se:* depois de várias fontes, não surgir nenhum padrão reutilizável entre elas.

**Hipótese D — Estratégia híbrida**
Um parser comum cobre a maioria dos casos (formatos de data, recorrência simples), com pequenos adaptadores por fonte apenas para peculiaridades específicas — nem um parser universal rígido (Hipótese A), nem lógica totalmente separada por fonte (Hipótese C).
*Aceita se:* a maior parte da lógica de extração for reaproveitável entre fontes, com pontos de extensão pequenos e localizados (não reescritas inteiras) para casos específicos.

**Nenhuma das quatro é aceita ainda.** Reavaliar com uma amostra maior — candidatas mapeadas na Região dos Lagos: Iguaba Grande (plataforma não confirmada), Araruama (confirmado NÃO ser WordPress), Arraial do Cabo e Saquarema (nunca investigadas nesta sessão). Decisão de quando expandir a amostra fica para depois da Sprint 2 — Operação Mínima, não decidida agora.

## Achado à parte — filtro editorial, antes do parser

O post da Procissão revelou uma categoria de conteúdo que nenhuma hipótese acima resolve: **notícia retrospectiva** (evento já ocorrido, sem utilidade como Activity futura). Isso é uma decisão de pipeline, não de parsing — "este post merece ser interpretado como Activity?" precisa de resposta antes de qualquer extração de data, não depois. Registado como achado separado, sem solução proposta ainda.

## Sobre o "Normalizer" — nota de implementação, não de arquitetura

Foi cogitada uma camada explícita `Candidate Temporal Expressions → Normalizer → Date Candidates`. Na prática, olhando o código real, isso já existe estruturalmente como `findAllCandidateDates()` — uma função que já produz uma lista de candidatos a partir de múltiplos padrões de regex. Estender essa mesma função com mais padrões (`(dd/mm)`, recorrência semanal) não é uma mudança arquitetural — é a Hipótese A em ação. Não tratar isto como justificativa para a Hipótese B.

---

## Conclusão da Discovery 1.2

O parser narrativo demonstrou dependência dos formatos editoriais observados em Cabo Frio. A análise de uma segunda fonte (São Pedro da Aldeia) revelou novos padrões temporais ainda não suportados. Neste momento há evidência suficiente para justificar a evolução incremental do parser, mas não há evidência suficiente para concluir que sejam necessários perfis editoriais distintos (Hipótese B), nem uma estratégia híbrida (Hipótese D) especificamente. Essa decisão permanece em aberto e será reavaliada após a análise de uma amostra maior de fontes.

**Nenhuma linha de código escrita nesta investigação.** Nenhuma ADR aberta — decisão explícita de aguardar mais evidência antes de fixar direção arquitetural.

---

## Próximos passos, na ordem combinada

```
✅ Sprint 1 — Activity Engine Discovery (1.1 + 1.2)

▶ Sprint 2 — Operação Mínima
    ~10 venues de SP (inside_radius, categorias/regiões variadas)
    ~10 activities manuais
    Checklist: Human Review → Approve → Promote → Publish → Criar Activity → Confirmar no App
    Registrar aprendizados operacionais (tempo, atrito, campos difíceis)

⏳ Sprint 3 — Activity Engine Discovery, Fase 2 (depois da Sprint 2)
    Amostra maior: Iguaba Grande, Araruama, Arraial do Cabo, Saquarema
    Objetivo: decidir entre Hipóteses A/B/C/D com confiança real
```

---

## Achado paralelo (2026-08-31) — o sistema legado `vida-ativa-admin`

Durante a Sprint 2, ao criar *activities* manuais pelo formulário "Editar Atividade", foi confirmado com código real que esse formulário **não pertence ao `admin-panel/`** (o Vivere Admin Panel já validado) — é um sistema separado, em repositório próprio (`vida-ativa-admin\index.html`), com o nome anterior do produto.

**Confirmado no código-fonte** (`save()`, linha 310): `await db.post('activities', body)` — escrita **direta** na tabela final, sem passar por `staging.activities_staging`, Entity Resolution, Human Review, `proposal_status`, ou Regional Geographic Gate. O mesmo padrão genérico (`db.post`/`db.patch`/`db.delete`) é usado também para `venues`, `partners`, e `categories` — CRUD único, sem noção do pipeline construído nesta sessão.

Isso explica o `product_key: 'legacy'` observado nas *activities* criadas manualmente — valor herdado do nome antigo do produto, nunca ajustado.

### Dois fluxos confirmados, lado a lado

```
Fluxo moderno (Engine)                    Fluxo legado (vida-ativa-admin)
Collector                                  Formulário
  ↓                                          ↓
staging.activities_staging                 db.post('activities', body)
  ↓                                          ↓
Entity Resolution                          public.activities
  ↓                                        (sem staging, sem review,
Human Review                                sem gate, sem publishing)
  ↓
Promote
  ↓
Publishing Engine
  ↓
public.activities
```

### Decisão de produto — Sprint 2

**`vida-ativa-admin` continua oficialmente suportado como ferramenta operacional** para criação manual de conteúdo durante a Sprint 2. Não é a arquitetura final, mas é hoje a única forma de validar o produto com usuários reais — desligá-lo agora contradiria o próprio objetivo da Sprint 2.

### Backlog — Convergência Administrativa

**Objetivo:** eliminar gradualmente o `vida-ativa-admin`, incorporando a criação manual de *activities* ao `Vivere Admin Panel`, seguindo o pipeline `Proposal → Review → Publish`.

**Critério de aposentadoria** (todos precisam ser verdadeiros):
1. Cadastro manual de *activities* disponível no `admin-panel/`
2. Esse cadastro segue o pipeline completo, não escreve direto em `public.activities`
3. Operação diária é possível sem depender do sistema legado

**Não é uma nova Sprint.** É uma direção arquitetural registada, sem data, sem código, reavaliada quando a operação amadurecer o suficiente para justificá-la.

---

## Achado paralelo (2026-09-18) — recorrência por dia da semana confirmada em `prefeitura_iguaba_grande`

Durante a validação da PR de isolamento de erro na Publishing Engine (ver Mini PR "Isolar falha de leitura por activity"), 3 registos em `staging.activities_staging` falharam a validação de `occurrences` por conterem o formato `{ day_of_week, time }` em vez de `{ date, time }`.

**Confirmado pelo log real de execução** (`--preview`, 2026-09-18): as 3 falhas têm `sourceKey: "prefeitura_iguaba_grande"`. Não Cabo Frio, como se assumiu inicialmente antes de ver o log — essa suposição foi corrigida assim que o dado real ficou disponível.

**Registo conservador, sem generalizar:** recurrence-shaped occurrences (`day_of_week` + `time`) foram observadas em registos com `sourceKey=prefeitura_iguaba_grande`. Não há, até este momento, evidência equivalente confirmada de que o mesmo padrão exista em Cabo Frio — essa afirmação não deve ser feita sem verificação directa dos dados de Cabo Frio.

Este achado é relevante para a Sprint 3 (amostra maior) — Iguaba Grande já está confirmada como fonte real no sistema (ainda que a plataforma/formato editorial completo dela não tenha sido investigado como foi feito para São Pedro da Aldeia), e já apresenta o mesmo tipo de lacuna de contrato (`occurrences` sem `date`) encontrada durante a Discovery 1.1/1.2.
