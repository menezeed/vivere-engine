# Vivere Engineering Principles

**Status:** Aceito
**Data:** 2026-08-17
**Âmbito:** Toda a Vivere Engine — Collectors, pipeline (00-filter-venue, 01-geographic-gate, etc.), persistência, scripts de entrada. Aplica-se a qualquer contribuidor, presente ou futuro.

**Objectivo:** Definir os princípios de engenharia que orientam a evolução da Vivere Engine. Estes princípios surgem de decisões tomadas durante o desenvolvimento e servem como referência para alterações futuras, revisão de código e desenho de arquitectura.

**Documento vivo** — não um registo histórico de tudo o que aconteceu. Decisões arquitecturais específicas (a razão concreta por trás de uma escolha, numa data específica) ficam nas ADRs, em `docs/adr/` — este documento guarda só as regras permanentes que essas decisões revelaram, e que continuam a valer depois de a decisão original já não ser notícia.

---

## Propósito

Este documento existe para responder, sem ambiguidade, duas perguntas que voltam a aparecer sempre que o projecto cresce:

- **"Onde coloco esta regra?"**
- **"Faço um caminho novo, ou reaproveito um existente?"**

Os cinco princípios abaixo nasceram de incidentes reais desta sessão de trabalho (Fase 9, Regional Baseline — Brooklin), não de teoria abstracta. Cada um está ligado a uma consequência concreta que já aconteceu no projecto.

**Relação com as ADRs (`docs/adr/`):** uma ADR regista *uma* decisão arquitectural, tomada numa data específica, com o contexto e as alternativas consideradas nesse momento (ex: ADR-0022 — Regional Geographic Gate). Este documento regista o padrão *permanente* que uma ou mais ADRs revelaram — sobrevive às ADRs individuais que o inspiraram. Uma ADR pode ficar obsoleta (superada por outra); um princípio, quando muda, é porque a própria filosofia de engenharia do projecto mudou — deve acontecer raramente.

### Regra para adicionar um princípio novo

Antes de propor um princípio novo, verificar primeiro se ele já está coberto por um dos existentes — mesmo que com um ângulo ligeiramente diferente. Só se justifica um princípio novo quando representa uma decisão arquitectural genuinamente distinta das cinco já registadas, não uma reformulação. O objectivo é manter esta lista pequena e forte — poucos princípios que orientam quase todas as decisões, não uma lista longa de regras sobrepostas.

---

## 1. Uma única fonte de verdade

Sempre que existir uma regra de negócio importante, ela deve existir **num único lugar** — nunca copiada ou reimplementada em mais do que um sítio.

**Porquê:** a mesma lógica de filtro de `--region=` estava duplicada em `dry-run-google-places.ts` e `ingest-google-places.ts`. Quando um foi corrigido, o outro ficou para trás — e essa divergência silenciosa causou uma execução real a processar três regiões em vez de uma, com custo multiplicado.

**Como se aplica:** `resolveRegionFilter` (filtro de região), `stageVenues` (filtro→*gate*→staging), `haversineMeters` (distância) — cada um existe uma vez só, partilhado por todos os caminhos que precisam dele.

## 2. Causa antes do teste

Quando um incidente acontece, a primeira pergunta é **"qual é a causa estrutural?"**, nunca "que teste teria apanhado isto?". Eliminar a causa (duplicação, acoplamento, ausência de validação) vem sempre antes de escrever testes novos.

**Porquê:** um teste sobre uma duplicação continua a deixar a duplicação lá — só a esconde melhor. Corrigir só um dos dois scripts com um teste não teria impedido o próximo a divergir.

**Como se aplica:** os dois bugs de `--region=` desta sessão foram corrigidos eliminando a duplicação (Princípio 1) **antes** de qualquer teste novo ser escrito.

## 3. Um único pipeline

Se duas funcionalidades executam o mesmo processo de negócio, devem **partilhar o mesmo pipeline**. A única diferença permitida entre elas é a origem dos dados.

**Porquê:** é a forma mais directa de garantir o Princípio 1 quando o "consumidor" da regra, não só a regra em si, se repete.

**Como se aplica:** `runVenueIngestion` (dados de um `Collector` ao vivo) e `reprocessVenuesFromRaw` (dados já persistidos em `raw_venue_items`) chamam o mesmo `stageVenues` privado — filtro, *gate* geográfico, e persistência em staging correm de forma idêntica nos dois casos.

## 4. Validação antes de expansão

Nenhuma frente nova de trabalho começa antes da frente anterior estar completamente validada — `tsc` limpo, testes reais a passar (não só sintaxe), critérios de aceitação explícitos cumpridos.

**Porquê:** é a disciplina que evitou um terceiro incidente de custo nesta sessão — um guarda de entry-point mal desenhado (`file://` comparado por *string*, que falha silenciosamente no Windows) foi apanhado antes de chegar ao ambiente real, precisamente porque cada passo parou para ser confirmado antes do seguinte começar.

**Como se aplica:** cada alteração ao pipeline é entregue como um mini PR com critérios de aceitação explícitos (ver secção seguinte); a próxima peça (ex: `reprocess-venues-from-raw.ts`) só começa depois desses critérios estarem confirmados no ambiente real.

## 5. Evidência antes de optimização

Antes de alterar arquitectura, desempenho, ou operação, tem de existir **evidência concreta** de que o problema existe — nunca especulação sobre o que "pode vir a ser preciso".

**Porquê:** nesta sessão, decidiu-se explicitamente não construir dashboards, observabilidade, ou monitorização de CPU/memória — não porque essas coisas sejam más ideias em abstracto, mas porque não havia nenhuma evidência de que fossem o problema real da Vivere Engine neste momento (um processo Node que corre 30 segundos, invocado manualmente, uma vez por região).

**Como se aplica:** qualquer proposta de optimização ou nova capacidade operacional deve começar por apontar o incidente, medição, ou lacuna concreta que a motiva — não o inverso.

---

## Formato de mini PR

Toda alteração ao pipeline (não documentação, não análise) é apresentada com esta estrutura:

1. **Objectivo** — que problema resolve
2. **Arquitectura** — porque esta solução, não outra
3. **Impacto** — que ficheiros/módulos mudaram
4. **Validação realizada** — que testes/verificações comprovam a correcção, e com que grau de confiança (sintaxe vs. execução real)
5. **Riscos** — o que pode correr mal, e que dependências novas isso cria
6. **Rollback** — como desfazer, e se exige migration
7. **Critérios de aceitação** — condições objectivas e verificáveis que definem "concluído", nunca "acho que está pronto"

---

## Nota de manutenção

Este ficheiro é revisto sempre que um mini PR propuser um princípio novo (ver regra acima) ou quando uma ADR revelar que um princípio existente já não reflecte a prática real do projecto. Fora isso, muda raramente — é esse o ponto.
