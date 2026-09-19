# ADR-0021 — Regional Expansion Strategy

**Status:** Completed
**Data:** 2026-07-13

---

## Contexto

A Fase 8 encerrou com a Publishing Engine validada em produção: Entity
Resolution, Publishing Engine, primeira publicação real, idempotência
confirmada em duas execuções consecutivas, migration 0016 aplicada,
integridade referencial garantida também ao nível da base de dados, e
`--preview` validado como representação fiel de `publish()`.

A arquitectura base está congelada a partir deste ponto. O objectivo da
Fase 9 deixa de ser desenvolver funcionalidades principais — passa a ser
validar que a plataforma escala para múltiplas regiões **mantendo a
qualidade dos dados**, através de um processo repetível.

Primeira região: **Brooklin, São Paulo** — motivo: existe um utilizador
local disponível para validar os dados publicados, tornando-a o primeiro
piloto com validação real por utilizador, não apenas validação técnica.

## Decisão

### Princípio central: separação entre arquitectura e conteúdo

A partir da Fase 9, nenhuma expansão regional deve exigir alterações ao
código do Publishing Engine, Entity Resolution, Collectors genéricos, ou
schema. Uma região nova é **configuração e conteúdo** — `source_query_text`
dos Collectors, um `product_key` (ou extensão de um existente), e o
trabalho de curadoria humana em Human Review. Se uma expansão regional
revelar a necessidade de alterar código congelado (como aconteceu durante
a validação de Cabo Frio, com os bugs de schema e de serialização), isso é
tratado como um **defeito descoberto**, corrigido, testado e documentado
antes de a região prosseguir — não como trabalho normal de expansão.

Esta distinção importa para estimativa e para responsabilização: trabalho
de "conteúdo" é previsível e repetível; trabalho de "arquitectura" é
excepcional e deve ser raro depois da Fase 8.

### Estratégia de ondas (waves)

As regiões avançam por ondas, uma de cada vez, nunca em paralelo antes da
primeira onda estar congelada. Ordem definida para a Fase 9:

1. **Brooklin** (São Paulo) — piloto, primeira validação por utilizador real
2. Campo Belo
3. Moema
4. Santo Amaro
5. Vila Olímpia
6. Itaim Bibi
7. Berrini
8. Restante de São Paulo (capital)

Cidades fora de São Paulo (Rio, Londres, ou outras) ficam para ondas
futuras, fora do escopo desta ADR — a estratégia de ondas aplica-se
primeiro dentro de São Paulo para validar o processo num território
conhecido antes de o replicar para geografias com características
distintas (idioma, densidade de fontes, comportamento do utilizador).

**Regra de progressão:** uma região só inicia a etapa de ingestão depois
da região anterior estar **congelada** (ver critérios abaixo). Isto é
deliberado — permite que cada onda seja mais rápida do que a anterior,
porque os padrões de curadoria (nomes coincidentes, duplicados, tipos de
Google Places recorrentes) descobertos numa região informam a próxima,
em vez de se acumular dívida de curadoria não resolvida em várias regiões
simultaneamente.

### Critérios para considerar uma região "congelada"

Uma região é declarada congelada quando **todos** os critérios abaixo
estão satisfeitos:

1. `--preview` executado e revisto por um humano, sem anomalias
   (`⚠ ANÓMALO`) por explicar.
2. Todos os grupos do relatório de duplicados foram revistos
   individualmente, com evidência (não suposição) — cada grupo resultou
   em decisão explícita (fundir / rejeitar / manter separados com nome
   curado).
3. Publicação real executada (`publish.ts` sem flags), com `status =
   success` ou `partial` explicado (nunca `failed` sem correcção).
4. Segunda execução de `publish.ts` corrida e confirmada idempotente
   (zero publicações novas, zero duplicação técnica, contagens estáveis).
5. Validação em campo concluída — o utilizador local (ou processo
   equivalente nas regiões seguintes, quando não houver utilizador
   dedicado) confirmou que o conteúdo publicado corresponde à realidade.
6. Todas as métricas obrigatórias (ver secção seguinte) recolhidas e
   registadas no Estado Oficial da Plataforma ou equivalente.
7. Nenhuma alteração de código pendente por causa desta região — se a
   região revelou um defeito, o defeito já foi corrigido, testado, e essa
   correcção documentada (ADR ou nota no Architecture Book), antes de a
   região ser considerada congelada.

Só depois de todos os sete critérios estarem satisfeitos a onda seguinte
pode iniciar a etapa de ingestão.

### Métricas obrigatórias antes da publicação

Estas métricas são recolhidas para **cada região**, antes de a região
avançar de "Preview" para "Publicação" (etapa 6→8 do Playbook), e ficam
registadas como parte do histórico da região:

| Métrica | O que mede |
|---|---|
| Venues encontrados | Total de `raw_venue_items` únicos coleccionados para a região |
| Activities encontradas | Total de `raw_activity_items` únicos coleccionados para a região |
| Matched | Activities com `venue_resolution_status = 'matched'` |
| Proposed_new | Activities com `venue_resolution_status = 'proposed_new'` |
| Unresolved | Activities com `venue_resolution_status = 'unresolved'` (ou equivalente) |
| Duplicados (venues) | Grupos reportados por `detectVenueDuplicates`, e quantos resultaram em fusão/rejeição vs. manutenção como entidades distintas |
| Taxa de confirmação humana | Proporção de venues/activities com decisão humana tomada (promoted/rejected para venues) sobre o total elegível para revisão |
| Tempo de ingestão | Duração da(s) corrida(s) de Collectors até `raw_*_items` estarem persistidos |
| Tempo de Entity Resolution | Duração do pipeline de ER sobre os novos `raw_*_items` |
| Tempo de Preview | Duração da execução de `publish.ts --preview` |
| Tempo de Publish | `duration_ms` da run em `public.publication_runs` |

A definição exacta de cada métrica (query ou método de medição) fica no
Regional Expansion Checklist, não nesta ADR — a ADR fixa **o quê** e
**porquê**; o Checklist fixa **como**, e pode evoluir sem reabrir esta ADR.

### Brooklin como Regional Baseline

Brooklin não é apenas a primeira região da Fase 9 — é declarado aqui como
o **Regional Baseline** da plataforma: a região de referência contra a
qual se avalia se uma mudança futura (novo matcher, novo Collector, novo
parser, novo algoritmo de qualquer natureza) é segura para o processo de
expansão regional.

A partir do momento em que Brooklin estiver congelado, qualquer mudança
candidata a entrar na plataforma deve responder a uma pergunta simples:
**"isto piora Brooklin?"** Se a resposta for sim — mesmo que a mudança
beneficie outra região — a mudança não entra sem antes ser revista contra
essa perda. Isto espelha, deliberadamente, o papel que **Cabo Frio** já
ocupa como baseline de engenharia desde a Fase 8: Cabo Frio valida que o
pipeline funciona; Brooklin valida que o processo de expansão regional
funciona. São dois baselines complementares, não concorrentes — um não
substitui o outro.

Na prática, isto significa: antes de qualquer alteração a Collectors,
Entity Resolution, Publishing Engine, ou parsers que afecte mais do que
uma região, correr `--preview` (e, quando aplicável, `publish.ts`) contra
Brooklin e confirmar que os números não pioram face ao estado congelado
mais recente dessa região — não é preciso re-congelar Brooklin a cada
verificação, apenas confirmar que a mudança não a degrada.

### GO / NO-GO — ponto formal de decisão

Cada região tem um ponto de decisão explícito e registado antes de
avançar para a região seguinte — não uma transição implícita. O
Regional Expansion Checklist regista, para cada região: decisão (GO/NO-GO
para a próxima região), motivo, responsável, e data. Isto é
particularmente relevante quando uma região não atinge todos os critérios
de congelamento mas há pressão para avançar mesmo assim — o registo torna
essa excepção visível e atribuível, em vez de silenciosa.

## Justificação

- Sem a separação arquitectura/conteúdo explícita, é fácil cada região
  "herdar" pequenas excepções de código que se acumulam e tornam a
  plataforma cada vez menos uniforme entre regiões — exactamente o
  problema que a estratégia de ondas e os critérios de congelamento
  existem para prevenir.
- A ordem de ondas dentro de São Paulo antes de outras cidades permite
  validar o *processo* (não só o código) num território onde já há
  conhecimento acumulado (fontes, convenções de nomes, tipos de venues
  comuns), antes de replicar para geografias com variáveis novas
  (idioma, fusos horários — relevante para ADR-0020 — e comportamento
  do utilizador).
- As métricas obrigatórias existem para que o "sucesso" de uma região
  seja definido por números, não por impressão — e para que regiões
  futuras possam ser comparadas objectivamente às anteriores (ex.: "esta
  região teve uma taxa de `unresolved` muito mais alta que Cabo Frio —
  porquê?").

## Consequências

- Cada onda tem uma dependência sequencial estrita da anterior estar
  congelada — isto é uma escolha deliberada de previsibilidade sobre
  velocidade bruta. Se a pressão de negócio exigir paralelizar regiões
  antes disso, essa decisão exige rever esta ADR explicitamente, não
  ignorá-la silenciosamente.
- O utilizador local do Brooklin é uma vantagem única desta primeira
  onda — regiões seguintes sem validador dedicado precisarão de um
  processo de validação em campo alternativo (critério 5), a definir
  quando se tornar relevante (provavelmente antes de Campo Belo).
- Esta ADR não define os detalhes técnicos de configuração de
  Collectors por região — isso permanece no Regional Expansion Checklist,
  que pode ser actualizado com mais frequência do que uma ADR.
- Declarar Brooklin como Regional Baseline implica uma verificação
  adicional em qualquer mudança futura de escopo amplo (Collectors,
  Entity Resolution, Publishing Engine, parsers): confirmar contra
  Brooklin que a mudança não o degrada, antes de a aceitar. Isto é um
  custo deliberado — mais barato do que descobrir a degradação depois de
  já estar em produção em várias regiões.

## Alternativas consideradas

| Opção | Razão de rejeição |
|---|---|
| Expandir para várias regiões em paralelo desde já | Risco de acumular dívida de curadoria não resolvida em várias frentes simultaneamente; contraria a lição da Fase 8 de que cada anomalia merece investigação individual |
| Ir directamente para cidades fora de São Paulo | Perderia a vantagem de testar o processo num território já conhecido antes de introduzir variáveis novas (idioma, fuso horário, densidade de fontes) |
| Não exigir métricas obrigatórias, avaliar região a região de forma ad-hoc | Repetiria o padrão que a Fase 8 evitou (decisões por suposição em vez de evidência) — aplicado agora ao nível de processo, não só de dados |


---

## Resultado (2026-08-22)

A pergunta para a qual esta ADR foi criada � "o modelo de Regional Baseline funciona quando aplicado a regi�es vizinhas?" � tem resposta confirmada por evid�ncia real:

- ? Brooklin (1� Regional Baseline) � arquitectura, determinismo, idempot�ncia validados
- ? Campo Belo (2�) � sobreposi��o com uma regi�o vizinha: 29,5%
- ? Moema (3�) � sobreposi��o com duas regi�es vizinhas simultaneamente: 38,2%

Duas medi��es reais de sobreposi��o crescente, ambas dentro do intervalo esperado, sem falha de integridade em nenhuma das tr�s regi�es testadas. ON CONFLICT por place_id continuou a garantir unicidade do cat�logo em todos os casos.

Detalhes completos em docs/regional-baselines/regional-baseline-report-v1.md, moema-planning.md, moema-metrics-snapshot.md.

**Esta ADR est� conclu�da � n�o alterada.** A ordem de ondas aqui definida (Brooklin?Campo Belo?Moema?Santo Amaro?...) cumpriu o seu papel de valida��o. Qualquer mudan�a futura no crit�rio de escolha de pr�ximas regi�es (por exemplo, valor incremental em vez de adjac�ncia geogr�fica) pertence a uma nova ADR, n�o a uma revis�o desta.
