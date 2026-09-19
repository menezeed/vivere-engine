# Regional Baseline Report v1

**Âmbito:** Brooklin (1ª Regional Baseline) + Campo Belo (2ª Regional Baseline)
**Fase:** Regional Expansion Validation
**Fontes:** `brooklin-metrics-snapshot.md`, `campo-belo-metrics-snapshot.md`, `campo-belo-planning.md`

---

## Objectivo da validação

Confirmar, com evidência real (não arquitectura no papel), que o pipeline da Vivere Engine — coleta, `00-filter-venue`, Regional Geographic Gate (ADR-0022), *staging*, Human Review — funciona de forma correcta e determinística ao alimentar mais do que uma região, e que o modelo de regiões continua válido quando duas regiões vizinhas partilham geografia real.

---

## Brooklin — resumo

Primeira Regional Baseline. Validou a arquitectura completa: reprocessamento (`reprocessVenuesFromRaw`), idempotência (`ON CONFLICT` por `place_id`), determinismo (confirmado formalmente — mesma entrada, mesmo resultado, mesmo com Camada A duplicada entre execuções), e o alinhamento do Human Review com o Regional Geographic Gate.

| Métrica | Valor |
|---|---|
| `raw_venue_items` (soma de todas as execuções de coleta) | 214 |
| *Staged* únicos (estado final) | 116 |
| `inside_radius` | 86 (74,1%) |
| `buffer_zone` | 5 (4,3%) |
| `outside_region` | 25 (21,6%) |
| Rejeitados | 6 |
| Duplicados por nome | 1 par |
| Custo real de ingestão (excluindo o incidente de custo abaixo) | ~USD 4,38 |

**Incidentes durante esta baseline:** dois bugs reais de custo (filtro `--region=` ausente/assimétrico entre scripts), que geraram execuções involuntárias de múltiplas regiões. Corrigidos na causa, não remendados — deram origem aos Engineering Principles e ao Mini PR de `resolveRegionFilter`.

## Campo Belo — resumo

Segunda Regional Baseline. Repetiu o ciclo operacional (definição → *dry-run* → ingestão → *snapshot*) sem nenhuma alteração de arquitectura ou código — confirma que o processo é replicável, não específico do Brooklin.

| Métrica | Valor |
|---|---|
| `raw_venue_items` coletados | 90 |
| *Staged* genuinamente novos | 62 |
| Já existentes — sobreposição com Brooklin | **26 (29,5% dos elegíveis)** |
| `inside_radius` (dos novos) | 7 (11,3%) |
| `buffer_zone` (dos novos) | 8 (12,9%) |
| `outside_region` (dos novos) | 47 (75,8%) |
| Rejeitados | 2 |
| Incidentes de custo | 0 |
| Custo total (*dry-run* + ingestão real) | USD 3,50 |

**Achado específico:** homonímia com Campo Belo, Minas Gerais — 8 resultados a ~332km, absorvidos correctamente pelo Regional Geographic Gate sem intervenção manual.

---

## Comparação — nota de leitura importante

As percentagens `inside_radius`/`buffer_zone`/`outside_region` de Campo Belo, na tabela acima, referem-se **só aos 62 venues genuinamente novos** — não ao total que a coleta devolveu (90). Os 26 venues sobrepostos com o Brooklin **mantiveram o `geographic_status` calculado a partir do centróide do Brooklin** (comportamento do `ON CONFLICT`, já confirmado), e já estão contabilizados nas métricas do Brooklin, não nas de Campo Belo. Comparar as duas tabelas directamente, item a item, sem este cuidado, sobrestimaria a diferença real entre as duas regiões.

| | Brooklin (estado final) | Campo Belo (só os novos) |
|---|---|---|
| `inside_radius` | 74,1% | 11,3% |
| `buffer_zone` | 4,3% | 12,9% |
| `outside_region` | 21,6% | 75,8% |

A diferença é real, mas tem explicação: os venues mais centrais de Campo Belo — os candidatos mais prováveis a `inside_radius` — são precisamente os que a zona partilhada com o Brooklin tinha mais probabilidade de já ter capturado primeiro. O que sobra para Campo Belo "descobrir de novo" tende a estar na periferia da sua própria área. Não é uma anomalia; é uma consequência directa de serem regiões vizinhas.

---

## Hipótese principal — resposta preliminar

> "O modelo de Regional Baselines continua correcto quando duas regiões vizinhas partilham naturalmente parte do mesmo ecossistema urbano?"

**Sim, com sobreposição real e mensurável (29,5%).** O `ON CONFLICT` por `place_id` (sem região na chave) preservou o dado correctamente — nenhuma duplicação, nenhuma escrita perdida, nenhum erro de integridade.

**Em aberto:** a hipótese secundária de produto (Cenário A/B/C de `campo-belo-planning.md` — a quem "pertence" um venue partilhado por duas regiões) continua sem resposta. Nenhuma evidência ainda obrigou a decidir; fica para quando Human Review real sobre estes casos específicos gerar esse sinal.

---

## Lições aprendidas

1. **Uma única fonte de verdade para lógica partilhada entre scripts** (Princípio 1) — os dois incidentes de custo do Brooklin nunca teriam acontecido se `resolveRegionFilter` tivesse existido desde o início.
2. **A Camada A não deduplica entre execuções de coleta** — é *append-only* por desenho; o volume cresce com o número de coletas, não com o número de venues únicos. Monitorizar à medida que mais regiões se acumularem.
3. **Homonímia de nomes de lugar é absorvida correctamente pelo Regional Geographic Gate**, sem exigir nenhuma regra nova — validado agora com um caso real (Campo Belo/MG), não só teoricamente.
4. **A sobreposição entre regiões vizinhas concentra-se no centro funcional partilhado**, não se distribui uniformemente — relevante para calibrar expectativas nas próximas ondas (Moema, Santo Amaro, Vila Olímpia são geograficamente próximas entre si e do Brooklin/Campo Belo).
5. **O ciclo reprocessar → medir → só depois coletar** (decisão operacional formal desde o *snapshot* do Brooklin) continua a ser a sequência certa — Campo Belo seguiu-o sem fricção.

## Decisões operacionais confirmadas para as próximas regiões

- `radius_m = 2.500` continua o valor por omissão, sem razão objectiva até agora para alterar
- *Dry-run* antes de qualquer ingestão real, sempre
- A partir da 3ª região, **reduzir a profundidade de análise por omissão** — Brooklin e Campo Belo já estabeleceram a metodologia; só investigar em profundidade se uma região mostrar comportamento genuinamente fora do padrão (sobreposição muito acima/abaixo do esperado, distribuição geográfica anómala, ou problema de qualidade de dados)

---

## Estado da fase

**Regional Expansion Validation — consolidada, não encerrada.** A pergunta central da fase tem resposta preliminar positiva. Próxima região (Moema, por ADR-0021) fica como decisão em aberto, sem data — a metodologia está pronta para ser reaplicada quando fizer sentido, sem repetir o nível de investigação que Brooklin e Campo Belo exigiram.

---

## Operational Pipeline Validation — Completed (2026-08-29, confirmado após correção)

**Nota de processo:** esta seção passou por duas versões no mesmo dia. A primeira afirmava conclusão sem evidência suficiente; foi corrigida para "parcialmente validado" ao descobrir a lacuna do `product_key`; a investigação subsequente (auditoria completa do fluxo do app, não só uma hipótese) encontrou a causa real e confirmou o ciclo completo com dados reais. As duas correções ficam registadas abaixo, não apagadas — documentam o próprio processo de investigação, não só o resultado final.

Depois de quatro Regional Baselines em São Paulo (Brooklin, Campo Belo, Moema, Santo Amaro), a metade *Venue* do ciclo do produto foi exercitada pela primeira vez com dados reais, ponta a ponta:

```
Google Places
    ↓
Regional Geographic Gate (ADR-0022)
    ↓
Venue Staging
    ↓
Human Review (approve → promote)
    ↓
Publishing Engine (execução manual — ver achado abaixo)
    ↓
public.venues                          ← ✅ VALIDADO
    ↓
Activity (cadastro manual, vinculada ao venue)
    ↓
public.activities
    ↓
public.active_activities (view — o que o app realmente lê)
    ↓
App                                     ← ✅ VALIDADO
```

**O ciclo completo, incluindo a metade *Activity*, está confirmado — com uma ressalva importante sobre como chegou lá.** A primeira tentativa de confirmar isso gerou uma conclusão errada (ver "O que foi corrigido" abaixo); só depois de uma auditoria completa do caminho real do app é que a causa raiz genuína foi encontrada e o ciclo confirmado de novo, dessa vez com evidência sólida.

### O que foi corrigido

A afirmação original ("primeira actividade publicada e vinculada, confirmada visualmente") misturava dois fatos que pareciam relacionados mas não são a mesma coisa:
1. Uma atividade cadastrada manualmente ("Alongamento para 60+") apareceu no app — **confirmado**
2. Essa atividade estava vinculada ao venue "Dafne Macruz", que veio da Engine — **confirmado**
3. ~~Isso confirma que o pipeline de Activities da Engine funciona~~ — **não confirmado; nunca existiu, até hoje, nenhuma linha em `public.activities` com `product_key = 'vivere-60-mais'`**

`SELECT DISTINCT product_key FROM public.activities` devolve só `'legacy'`. Ao tentar reproduzir o mesmo teste com outro venue promovido via Engine ("Museu de Santo Amaro - CETRASA"), sem nenhuma *activity* manual vinculada, o venue não apareceu no app — coerente com a descoberta de que venue sozinho é invisível, mas ainda não isola se o problema é "falta activity" ou "activity existe mas `product_key` errado bloqueia".

**Auditoria concluída (mesmo dia) — causa raiz real identificada, `product_key` descartado.**

Localizamos a *query* real do app: ele não lê `public.activities` diretamente — lê **`public.active_activities`**, uma *view*:

```sql
WHERE (end_date IS NULL OR end_date >= CURRENT_DATE)
  AND (
    (recurrence_type IS NOT NULL AND recurrence_type <> 'none')
    OR
    (recurrence_type = 'none' AND start_date >= CURRENT_DATE)
  )
```

**Nenhum filtro por `product_key` existe nessa view.** A hipótese inicial estava errada. A causa real do "Museu de Santo Amaro" não aparecer era mais simples: **promover um venue no Admin Panel só marca `proposal_status = 'promoted'` em `staging.venues_staging` — não copia para `public.venues`.** Essa cópia só acontece quando `src/publishing/publish.ts` é executado manualmente, sem `--preview`, depois da promoção. Esse passo tinha sido esquecido.

**Confirmação final, com dado real:** depois de rodar `publish.ts` e criar uma *activity* de teste com `recurrence_type = 'weekly'` vinculada ao "Museu de Santo Amaro - CETRASA", ela apareceu no aplicativo. O ciclo completo `Venue Engine → Human Review → Publishing Engine → public.venues → Activity → public.active_activities → App` está confirmado, ponta a ponta, com dados publicados via Engine (não só cadastro manual).

**Achado operacional a reter para o Lote 1 (50 venues):** a Publishing Engine **não roda automaticamente** depois de uma promoção no Admin Panel — é um passo manual separado. Sem lembrar de rodar `publish.ts` ao final de cada lote, venues ficam "promovidos" em *staging* sem nunca chegar ao app.

### Bugs reais encontrados e corrigidos durante a validação

1. **Sessão do servidor da Review API presa a uma chave/estado antigo** — `approve`/`promote` retornavam `{"success":true}` sem persistir nenhuma alteração no banco. Resolvido reiniciando o processo do servidor; nenhuma alteração de código foi necessária.
2. **Defesa em profundidade contra `outside_region` na Publishing Engine nunca tinha sido aplicada ao código real** — `PublishableVenueRepository.findUnpublished`/`findDirty` não filtravam por `geographic_status`, apesar de essa correção já ter sido desenhada e testada anteriormente nesta sessão. Um venue `outside_region` promovido por engano ("Bora Dançá? Centro de Danças") apareceu na lista de publicação antes da correção ser aplicada de fato. Corrigido com `.or('geographic_status.is.null,geographic_status.neq.outside_region')`, confirmado via `--preview` antes e depois.

### A descoberta mais importante

**Um venue sozinho, sem nenhuma *activity* vinculada, é estruturalmente invisível para o usuário final** — mesmo `active`, publicado, com todos os campos corretos. O produto é orientado a *Activity*, não a *Venue*; o venue existe só como contexto/local de uma atividade. Isso não é um bug — é a arquitetura de dados do aplicativo (`public.activities.venue_id` como chave estrangeira), mas só ficou visível ao tentar confirmar visualmente o primeiro venue publicado desta sessão.

### Post-mortem — uma página

**O que funcionou:**
- Toda a arquitetura de Venue (Regional Geographic Gate, Human Review, Publishing Engine) funcionou como desenhada, sem exigir nenhuma mudança estrutural
- O processo de investigação incremental (um venue de cada vez, confirmando cada etapa antes de escalar) encontrou dois bugs reais com custo mínimo — o mesmo princípio que já guiou toda a Fase 9/10

**O que não funcionou, na primeira tentativa:**
- Duas suposições implícitas nunca verificadas (sessão do servidor sempre atualizada; defesa `outside_region` realmente aplicada) só foram descobertas ao tentar publicar de verdade
- A suposição de que "venue publicado = visível no app" nunca tinha sido testada antes desta sessão
- A afirmação inicial de que o ciclo `Venue → Activity → App` estava validado via Engine foi corrigida no mesmo dia, ao descobrir que a atividade de teste usada para confirmar isso veio do formulário manual (`product_key = 'legacy'`), não da Engine (`product_key = 'vivere-60-mais'`) — os dois nunca foram a mesma coisa

**O que descobrimos:**
- O verdadeiro gargalo do produto não é mais a descoberta de venues (263 já catalogados em SP, zero revisados) — é a ausência de um pipeline de *Activities* equivalente ao de *Venues*
- Google Places, estruturalmente, nunca vai produzir *Activities* com data/horário — só descobre locais
- O app lê de `public.active_activities` (uma *view*, com filtro por `end_date`/`recurrence_type`/`start_date`), não diretamente de `public.activities` — nenhum filtro por `product_key` existe nesse caminho
- A causa real de um venue promovido não aparecer no app era operacional, não arquitetural: a Publishing Engine precisa ser executada manualmente depois da promoção — não roda sozinha

**O que muda daqui para frente:**
- O foco da Engine muda de "descobrir venues" para "descobrir atividades" — a prioridade explícita da próxima fase
- Consolidar o passo manual esquecido (rodar `publish.ts` depois de promover) no *checklist* operacional do Lote 1, para não repetir o mesmo esquecimento em escala

### Inventário de fontes de Activities — investigação, sem código

| Fonte | Estruturada? | Datas? | Horários? | Reaproveita `WordPressContentCollector`? |
|---|---|---|---|---|
| Cabo Frio | ✅ (confirmado, Fase 8) | ✅ | ✅ | ✅ já integrado |
| São Pedro da Aldeia | Confirmado WordPress (Elementor); formato de conteúdo (estruturado tipo "SERVIÇO:" vs. narrativo) — não confirmado | ? | ? | Provável, a confirmar |
| Araruama | Tem Agenda de Eventos real, com datas — plataforma "Máxima Tecnologia" | ✅ (na agenda) | ? | ❌ não é WordPress, exigiria *collector* novo |
| Iguaba Grande | Site principal parece WordPress; subdomínio `eventos.iguaba.rj.gov.br` bloqueado por `robots.txt`, nunca confirmado | ? | ? | ? |
| Richmond / Reino Unido | Não investigado nesta sessão | ? | ? | ? |
| Brooklin / Campo Belo / Moema / Santo Amaro (Google Places) | N/A — fonte não produz *Activities* estruturalmente | ❌ | ❌ | N/A |

**Próximo passo, quando retomado:** confirmar o formato de conteúdo de São Pedro da Aldeia (candidata mais barata — já é WordPress) antes de decidir se `WordPressContentCollector` serve diretamente ou precisa de adaptação. Nenhuma linha de código a escrever nesta etapa — só mapear, como já fizemos aqui.
