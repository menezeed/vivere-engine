# Planeamento do Regional Baseline — Campo Belo

**Status:** Planeamento, sem implementação
**Depende de:** ADR-0021 (Regional Expansion Strategy), Brooklin como Regional Baseline confirmado (`brooklin-metrics-snapshot.md`)
**Ordem confirmada:** Campo Belo é a 2ª onda, conforme ADR-0021 — inalterada. Vila Mariana/Pinheiros, mencionadas numa discussão anterior como observação estratégica geral, não entram na ordem sem uma ADR revista com justificação baseada em dados; não é o caso aqui.

---

## 1. Qual é a hipótese que queremos validar em Campo Belo?

> ### Hipótese principal (arquitectura, não conteúdo)
> **O modelo actual de Regional Baselines continua correcto quando duas regiões vizinhas partilham naturalmente parte do mesmo ecossistema urbano?**
>
> Formulação técnica equivalente: valida se o modelo de `venues_staging`, baseado em unicidade por `place_id`, continua correcto quando uma segunda Regional Baseline (Campo Belo) redescobre venues já existentes provenientes do Brooklin.

Não é "Campo Belo tem mais academias?" nem "Campo Belo terá mais venues?" — essas são perguntas de conteúdo, que a curadoria responde naturalmente à medida que a região avança. Também não é apenas "o que acontece quando Campo Belo redescobre venues do Brooklin?" — essa framing ainda trata a sobreposição como um efeito colateral a gerir. A formulação correcta é mais ampla: **Campo Belo é o primeiro teste de sobreposição regional** — a primeira vez que duas Regional Baselines partilham geografia real, não hipotética.

Isto não é especulação — já temos evidência concreta no próprio conjunto de dados do Brooklin. Na revisão de qualidade da Opção A, encontrámos, classificados `inside_radius` (dentro do raio configurado do Brooklin):

- **"Rubel Academia - Unidade Campo Belo"**
- **"Praça Estação Campo Belo"**

E a pesquisa geográfica feita agora (ver secção 5) confirma que **isto não é anomalia — é consequência directa da própria organização urbana**: uma fonte lista "Brooklin Novo" e "Brooklin Paulista" como bairros constituintes do próprio distrito de Campo Belo. A sobreposição não é um erro da Google Places nem da Engine; faz parte da realidade da cidade. A pergunta que só uma **segunda** região consegue colocar, e que o Brooklin sozinho nunca podia responder: **como o modelo actual se comporta quando a mesma entidade pertence, na prática, a duas regiões vizinhas?**

A questão técnica concreta: o `ON CONFLICT` de `venues_staging` é por `(source_key, source_item_id, product_key)` — **não inclui região**. Se o mesmo `place_id` for descoberto primeiro pelo Brooklin (com `geographic_status` calculado a partir do centróide do Brooklin) e depois "redescoberto" por Campo Belo, o `INSERT ... ON CONFLICT DO NOTHING` **preserva o `geographic_status` da primeira execução** — o valor calculado a partir do centróide de Campo Belo nunca chega a ser gravado.

### Hipótese secundária — de produto, não de código

Quando o mesmo `place_id` é encontrado em duas Regional Baselines diferentes, **qual é a interpretação correcta para o Vivere 60+?** Três cenários conceptuais, com implicações diferentes para a experiência do utilizador e para a forma como a plataforma organiza actividades — nenhum decidido agora, só registado:

- **Cenário A** — o venue pertence às duas regiões (aparece nas duas, sem preferência).
- **Cenário B** — o venue pertence só à região onde foi descoberto primeiro (o comportamento actual, por acidente de implementação, não por decisão de produto).
- **Cenário C** — o venue é único, mas aparece nas pesquisas das duas regiões (distinção entre "onde vive no sistema" e "onde é descoberto/mostrado").

**Não resolver agora** — ainda não há dados suficientes para decidir com evidência, e decidir sem eles seria repetir o erro que já evitámos várias vezes nesta sessão. Fica registado porque decorre directamente da hipótese principal, e a resposta aos três critérios de sucesso abaixo (em particular, cair no critério 3 — limitação estrutural) é o sinal de que esta pergunta de produto precisa de ser respondida antes de Moema/Santo Amaro, onde a mesma sobreposição vai voltar a acontecer.

### Critérios de sucesso — definidos antes da coleta, não depois

Nenhum dos três resultados possíveis é fracasso; todos produzem conhecimento:

1. **O comportamento actual está correcto, nenhuma alteração é necessária** — o primeiro `geographic_status` gravado é uma decisão aceitável (a região que descobriu o venue primeiro "reclama-o"), e isto fica documentado como comportamento intencional. Equivale ao Cenário B da hipótese secundária, tornado explícito.
2. **O comportamento revela uma limitação, mas é tratável em Human Review** — por exemplo, um curador percebe o `geographic_status` "errado" e corrige manualmente; não exige mudança de código, só um passo a mais na curadoria.
3. **O comportamento revela uma limitação estrutural que justifica uma ADR** — por exemplo, se `venues_staging` precisar de saber "elegível para múltiplas regiões" em vez de uma atribuição única (Cenário A ou C), isso é uma mudança de modelo de dados que merece decisão formal, não um remendo.

Qualquer um dos três é uma resposta válida ao planeamento. Só depois de ver os números reais é que se escolhe entre eles.

## 2. O que esperamos que seja diferente do Brooklin?

Com base no que já sabemos (não em suposição nova):

- **Sobreposição de venues reais mais alta que qualquer onda futura terá com Brooklin** — por causa da adjacência administrativa já confirmada. Esperamos ver isto reflectido num número visível de `place_id` repetidos entre as duas regiões.
- **A mesma limitação de precisão de tipo** (nomes de condomínios com "Parque"/"Park") deve reaparecer — Campo Belo é geograficamente semelhante ao Brooklin (residencial denso, São Paulo), não há razão para esperar que desapareça.
- **A mesma característica do Google Text Search** (marcos conhecidos a "vazar" para além do raio) deve manter-se — não é uma característica de nenhuma região específica, é do próprio mecanismo de busca.
- **Não temos hipótese fundamentada sobre volume bruto** (mais ou menos venues que o Brooklin) — seria especulação sem dados prévios sobre a densidade comercial/cultural de Campo Belo especificamente.

## 3. Que métricas do *snapshot* serão comparadas?

As mesmas 8 já usadas para o Brooklin (`brooklin-metrics-snapshot.md`), sem alteração de formato — nenhuma métrica nova a inventar antes de haver evidência de que falta alguma:

1. `raw_venue_items` coletados/lidos
2. *Staged* em `venues_staging` (novos vs já existentes por `ON CONFLICT`)
3. Rejeitados (tipo/*keyword*)
4. `outside_region` (contagem/%)
5. Distribuição `inside_radius`/`buffer_zone`/`outside_region`
6. Duplicados por nome
7. Duração
8. Custo

**Uma métrica adicional, específica desta comparação inter-regional** (não uma 10ª métrica genérica — só relevante quando há duas regiões geograficamente próximas a comparar):

9. **Sobreposição de `place_id` entre Campo Belo e Brooklin** — quantos venues descobertos pela coleta de Campo Belo já existiam em `venues_staging` a partir do Brooklin, e com que `geographic_status` ficaram (o da região que os descobriu primeiro).

## 4. Qual será o critério para considerar Campo Belo uma Regional Baseline?

Os mesmos sete critérios já fixados na ADR-0021 — não redefinidos aqui, só aplicados:

1. `--preview` revisto, sem anomalias por explicar
2. Duplicados revistos com evidência e decisão explícita
3. Publicação real executada, `status` explicado
4. Segunda execução confirmada idempotente
5. Validação em campo concluída
6. Métricas obrigatórias registadas
7. Nenhuma alteração de código pendente por causa desta região

**Critério adicional, específico por ser a 2ª onda** (novo aqui porque só faz sentido a partir da segunda região — não existia forma de o testar só com o Brooklin): **o ciclo completo correu sem exigir nenhum Mini PR de arquitectura.** Se Campo Belo revelar a necessidade de alterar `IngestionOrchestrator`, `00-filter-venue`, ou `01-geographic-gate`, isso não invalida a região — mas muda a natureza da onda de "aplicação do processo" para "evolução da Engine", e o Mini PR correspondente segue a disciplina já estabelecida (causa raiz → correcção → reprocessar Brooklin para confirmar que não piorou, por ser a Regional Baseline — o teste "isto piora Brooklin?" da ADR-0021).

---

## 5. O que significa "Campo Belo"? — a preparação antes da Etapa 1

Esta pergunta parece trivial, mas não é. Respondê-la agora evita que o centróide e o raio sejam escolhidos depois, "para caber os dados" — devem ser consequência de uma definição operacional, não o contrário.

> ### Objectivo operacional (declarado explicitamente, para não precisar de ser reinventado daqui a seis meses)
> **A Regional Baseline de Campo Belo não pretende reproduzir os limites administrativos do distrito.** O objectivo é definir uma região operacional suficientemente representativa para alimentar o Vivere 60+, mantendo continuidade metodológica com as Regional Baselines anteriores (círculo técnico centróide + raio, nunca polígono administrativo).
>
> Esta frase existe para prevenir um erro específico e previsível: alguém, mais tarde, "corrigir" a Engine para coincidir exactamente com os limites oficiais do distrito, achando que isso é mais rigoroso. Não é — seria menos consistente com o método já validado, e (dado o achado abaixo) produziria sobreposição ainda maior com o Brooklin, não menor.

### Factos geográficos reais (pesquisados, não assumidos)

- **Campo Belo é um distrito oficial**, administrado pela **Subprefeitura de Santo Amaro** — a mesma subprefeitura, note-se, referida em fontes sobre o próprio Brooklin Velho.
- Os limites administrativos oficiais mais citados: **Av. dos Bandeirantes, Av. Santo Amaro, Av. Vicente Rao, Av. Vereador João de Luca, Av. Vereador José Diniz, Av. Washington Luís, Av. Jornalista Roberto Marinho** — com variação conforme a fonte (limites administrativos exactos vêm de lei municipal, não de sites de imobiliárias, que aproximam).
- **Faz fronteira directa com Brooklin, Brooklin Novo, Vila Congonhas e Moema** — confirmado por múltiplas fontes independentes.
- **Uma fonte lista "Brooklin Novo" e "Brooklin Paulista" como bairros constituintes do próprio distrito de Campo Belo** — o que, a ser preciso, significa que uma definição por limite administrativo estrito faria Campo Belo **conter** parte do que já tratámos como Brooklin, não apenas fazer fronteira com ele.
- **Referência histórica estável**: a região ganhou o nome "Estação Campo Belo" em 1967, por causa da estação ferroviária/atual estação de metro — um ponto de referência tão conhecido e estável quanto a Av. Padre Antônio José dos Santos foi para o Brooklin.

### A decisão, para manter o método consistente entre baselines

Concordo com o teu fecho — comparações entre regiões só são confiáveis se o método de definição for sempre o mesmo. Por isso, a recomendação é: **manter exactamente a mesma abordagem usada no Brooklin — círculo técnico (centróide + raio), nunca limite administrativo.** Duas razões, uma de método e uma específica deste caso:

1. **Consistência**: se o Brooklin foi definido por círculo técnico e Campo Belo por polígono administrativo, qualquer diferença nos resultados deixa de ser comparável — não se sabe se a diferença vem da região ou do método de a definir. Isto era exactamente o teu ponto de fecho.
2. **Específica de Campo Belo**: dado que o limite administrativo parece conter directamente parte do Brooklin (ver acima), usar esse limite tal como está faria o piloto de Campo Belo redescobrir uma fracção muito grande do que já foi coberto — reduzindo a cobertura genuinamente nova a pouco, e tornando a hipótese principal (secção 1) difícil de isolar de "estamos só a reler o Brooklin outra vez".

**Candidato a centróide, para confirmares no Google Maps** (não uso isto como decisão final — só como ponto de partida a validar, tal como fizemos com a Av. Padre Antônio José dos Santos): a zona da **antiga/actual Estação Campo Belo**, por ser um ponto de referência estável, historicamente central ao bairro, e mais afastado da fronteira partilhada com o Brooklin do que o centro geométrico do distrito inteiro estaria.

### Critérios para tratar venues na fronteira

Reaproveita-se directamente o que já existe — **não é preciso nenhum conceito novo**:

- `inside_radius`/`buffer_zone`/`outside_region` (ADR-0022) já respondem "isto pertence ao raio técnico de Campo Belo?" — a mesma pergunta que respondem para qualquer região.
- A pergunta nova, específica desta segunda baseline, é a que a hipótese principal levanta: "isto **já pertencia** ao raio técnico de outra região (Brooklin)?" — essa resposta vem da métrica 9 (secção 3), não de um critério de fronteira novo.

### O que "de Campo Belo" significa para efeitos de análise

Um venue conta para as métricas de Campo Belo quando: (a) foi devolvido por uma query cujo `source_region_label = 'Campo Belo, São Paulo'`, **independentemente** de já existir em `venues_staging` vindo do Brooklin. A métrica 9 mede a sobreposição separadamente — não se exclui um venue das métricas de Campo Belo só porque o Brooklin o viu primeiro.

---

## O que este documento não decide

- **Coordenadas exactas do centróide** — proponho um candidato (zona da Estação Campo Belo, secção 5), mas a confirmação final no Google Maps, e o raio inicial, ficam para a Etapa 1 do Regional Expansion Checklist — a mesma confirmação humana que fizemos para o Brooklin, não a decidir aqui.
- Se a sobreposição de `place_id` entre regiões (hipótese principal) exige correcção arquitectural — só decidimos isso depois de ver os números reais.

## Sequência confirmada

1. ✅ Brooklin encerrado como Regional Baseline
2. ✅ Campo Belo Planning concluído (este documento, incluindo a definição operacional da secção 5)
3. ✅ Conceito operacional da região definido — círculo técnico, candidato a centróide identificado, critérios de fronteira reaproveitados do já existente
4. ⏸️ Etapa 1 do Checklist — confirmação humana das coordenadas exactas, raio inicial, `region_key` — só quando decidires avançar
