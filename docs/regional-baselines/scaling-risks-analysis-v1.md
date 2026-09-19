# Riscos para Escalar a Vivere Engine — Análise Crítica (Pós Brooklin + Campo Belo)

**Metodologia:** cada risco abaixo tem origem em evidência real, observada nesta sessão, não em preocupação genérica de "boas práticas de escala". Onde a evidência é inferência (extrapolação, não medição directa), isso é assinalado explicitamente. Nenhuma recomendação foi implementada — são propostas para avaliação, não código.

---

## 1. Modelo de visibilidade regional ainda não decidido

**Reformulação, face à análise inicial:** não é "sobreposição sem decisão" — a Engine já decidiu correctamente as duas primeiras perguntas. O que falta é uma terceira, distinta, que só ficou visível depois de Campo Belo:

```
Venue
  → Descoberto por (região que gerou a coleta) — já decidido
  → Classificado pelo Geographic Gate dessa região — já decidido (ADR-0022)
  → Visível em quais regiões? — EM ABERTO
```

**Evidência real:** 29,5% dos venues que Campo Belo tentou descobrir já existiam via Brooklin. O `ON CONFLICT` por `place_id` (sem região na chave) preserva correctamente descoberta e classificação da primeira execução — isso está certo, não é o problema. O problema é que a pergunta "quando um utilizador abre Campo Belo, o que ele espera ver?" ainda não tem resposta de produto — hoje, a resposta implícita é "o que não foi reivindicado primeiro por outra região", um efeito colateral da ordem de ingestão, não uma decisão.

**Porque piora com escala:** Moema, Santo Amaro, Vila Olímpia, Itaim Bibi são geograficamente próximas entre si e do Brooklin/Campo Belo. A taxa de sobreposição tende a subir, não descer, à medida que mais regiões adjacentes se acumulam.

**Impacto:** médio-alto — não é um risco de integridade de dados (a Engine protege-se correctamente), é um risco de experiência: um venue geometricamente dentro do raio de Campo Belo pode nunca ser visível para um utilizador de Campo Belo, só porque o Brooklin o descobriu primeiro numa execução anterior.

**Probabilidade:** alta — já aconteceu, e a tendência é crescer com mais regiões vizinhas.

**Decisão explícita: adiar, não decidir agora.** Duas regiões não são evidência suficiente para escolher entre manter o modelo actual (descoberta = visibilidade, implícito) ou separar as duas (visibilidade calculada em tempo de leitura, sem alterar o modelo de descoberta/classificação já validado). Critério para retomar: observar a taxa de sobreposição em Moema e Santo Amaro.
- Se continuar na faixa de 20-30% já observada → o modelo actual pode ser aceitável, ajustar só se Human Review sinalizar frustração real
- Se subir para 50-60% → a pressão para desacoplar visibilidade de descoberta fica muito mais forte, e a decisão ganha uma base de evidência muito mais sólida do que a que existe hoje

Quando essa decisão for tomada, regista-se como ADR — é uma decisão arquitectural específica, com contexto e alternativas, não um princípio permanente nem parte deste documento de riscos.

---

## 2. Crescimento não-deduplicado da Camada A (`raw_venue_items`)

**Evidência real:** confirmado numericamente — Brooklin sozinho gerou 214 linhas em `raw_venue_items` para ~116 venues únicos finais (por reprocessamento + duas coletas reais). Campo Belo soma mais 90. A tabela cresce com o número de *execuções de coleta*, não com o número de venues únicos — comportamento intencional (preserva histórico), mas sem limite.

**Porque piora com escala:** 50-100 regiões, cada uma potencialmente reingerida múltiplas vezes ao longo do tempo (correcções de regras, testes, etc.), pode levar a Camada A a crescer numa ordem de grandeza muito maior que os dados úteis reais.

**Impacto:** baixo-médio no curto prazo (armazenamento é barato); médio no médio prazo (tempo de query, custo de índices, tempo de *backup*).

**Probabilidade:** alta, mas lenta — não é um risco agudo, é um risco de acumulação.

**Recomendação, não implementada:** nenhuma acção agora (seria optimização prematura). Definir um gatilho de revisão explícito — por exemplo, "revisitar quando `raw_venue_items` ultrapassar N milhões de linhas" — em vez de monitorizar sem critério.

---

## 3. Precisão de classificação — "parque"/condomínios, recorrente em duas regiões independentes

**Evidência real:** o mesmo padrão (nomes de condomínios com "Parque"/"Park" a passar pelo filtro de tipo) apareceu **de forma independente** no Brooklin ("Cyrela Eden Park", "Edifício Cipó Brooklin - O Parque") e em Campo Belo ("Sky Campo Belo" classificado `apartment_complex`, aceite via `NEEDS REVIEW`). `reject_type_residential` foi adiado duas vezes por falta de evidência suficiente — **agora há evidência de recorrência em duas regiões diferentes**, o que muda o argumento de "pode ser coincidência do Brooklin" para "é um padrão estrutural do tipo de dado que o Google Places devolve em áreas residenciais densas".

**Porque piora com escala:** toda região residencial densa de São Paulo (que é a maioria da Grande São Paulo) provavelmente repete este padrão — cada nova região soma mais itens a `NEEDS REVIEW` sem necessidade, se o padrão não for endereçado.

**Impacto:** médio — não é erro de dados (nada é publicado incorrectamente, a Camada de revisão apanha), mas é desperdício de esforço humano acumulado, crescente e previsível.

**Probabilidade:** alta — já se confirmou em 2 de 2 regiões observadas.

**Recomendação, não implementada:** esta é, na minha leitura, a candidata mais forte a deixar de ser "adiada por falta de evidência" — a evidência já existe, dobrada. Vale reavaliar antes da 3ª região, não como urgência, mas como prioridade justificada.

---

## 4. Operação inteiramente manual, sem agendamento nem automação

**Evidência real:** todo o ciclo desta sessão — *dry-run*, ingestão, reprocessamento — foi corrido manualmente por ti, no PowerShell, com falhas reais no processo (chave de API em variável de sessão esquecida, servidor da Review API nunca arrancado, `.env` a confirmar manualmente) que consumiram tempo de diagnóstico significativo, não por bug de código, mas por ausência de automação/verificação prévia.

**Porque piora com escala:** 50-100 regiões, cada uma exigindo os mesmos passos manuais repetidos por uma só pessoa, tem um tecto de produtividade óbvio — e o tipo de erro humano que já vimos nesta sessão (esquecimentos de ambiente, processos não iniciados) tende a multiplicar-se com fadiga e volume, não a desaparecer.

**Impacto:** alto no tempo/custo operacional, ainda que baixo no risco de integridade de dados (a Engine em si continua a proteger-se correctamente, como já provado).

**Probabilidade:** alta — é basicamente certo que aconteça de novo, dado que já aconteceu várias vezes nesta mesma sessão.

**Recomendação, não implementada:** não é "construir mais funcionalidades" — é reduzir passos manuais que já mostraram ser frágeis (ex: um *script* de arranque único que confirma `.env`, arranca a Review API, e corre um *health check*, antes de qualquer *dry-run*). Vale a pena só quando o volume de regiões justificar o investimento — não agora, com duas regiões.

---

## 5. Custo por venue genuinamente novo, degradando com a densidade de cobertura já existente

**Evidência real:** Campo Belo custou USD 1,75 na coleta real, mas só 62 dos 90 venues devolvidos (69%) eram genuinamente novos — os outros 26 já existiam via Brooklin. Não existe hoje nenhum mecanismo que avise, *antes* de gastar dinheiro, "esta região tem sobreposição alta com cobertura já existente, o retorno marginal pode ser baixo".

**Porque piora com escala:** à medida que mais regiões adjacentes forem cobertas, cada região nova nasce com mais sobreposição potencial com as anteriores — o custo por venue genuinamente novo tende a subir, não a manter-se estável, especialmente em zonas urbanas densas como a que já estamos a cobrir.

**Impacto:** médio — é dinheiro real, mas o volume actual (USD 1-2 por região) ainda é pequeno; se a taxa de sobreposição continuar a subir ao longo de dezenas de regiões, o orçamento mensal (USD 10, `hard_stop_enabled: true`) pode tornar-se uma limitação real antes do esperado.

**Probabilidade:** média — depende directamente de quão densamente sobrepostas forem as próximas regiões da ADR-0021 (Moema, Santo Amaro, etc., todas vizinhas entre si).

**Recomendação, não implementada:** nenhuma acção de código agora. Vale a pena, à 3ª ou 4ª região, calcular explicitamente "USD por venue novo" como uma das métricas do *snapshot*, para detectar a tendência antes que se torne um problema orçamental real.

---

## Priorização, actualizada após discussão

1. **Risco 1** (modelo de visibilidade regional) é o de maior peso conceptual — a única decisão que toca directamente o modelo de dados do produto, não só a Engine. **Decisão explícita: adiada até Moema/Santo Amaro trazerem mais evidência sobre a taxa de sobreposição.** Não é uma acção pendente agora, é um ponto de observação para a 3ª/4ª região.
2. **Risco 3** (precisão residencial) continua a candidata prática mais forte para acção, mas também adiada por decisão explícita — esperar uma 3ª região confirmar o padrão antes de implementar `reject_type_residential`, transformando evidência "forte" em evidência "estrutural"
3. Os restantes (2, 4, 5) são risco de **acumulação lenta**, correctamente não urgentes com só duas regiões — vale registá-los como gatilhos de revisão futura, não como trabalho actual

**Nenhuma acção de código decorre desta análise agora.** O valor desta sessão foi nomear e priorizar os riscos reais, não resolvê-los — resolvê-los sem mais regiões seria decidir sem evidência suficiente, o oposto do que esta sessão inteira tentou demonstrar como disciplina.

Nenhum destes cinco é uma falha na arquitectura validada até aqui — todos são consequências naturais de crescer de 2 para dezenas de regiões, exactamente o tipo de conhecimento que só aparece com dados reais, como já vimos repetidamente nesta sessão.

---

## Nota adicional — Legacy `raw_venue_items` (208 registos pré-regionalização)

Durante a expansão da Região dos Lagos (Cabo Frio, Araruama, São Pedro da Aldeia, Iguaba Grande), identificou-se um lote de 208 `raw_venue_items` coletados em 2026-07-03, antes da existência de `source_region_label`, cobrindo múltiplas cidades da Região dos Lagos numa única execução não regionalizada.

**Análise realizada, com números reais:**
- 180 (86,5%) já foram naturalmente recuperados pelas execuções regionalizadas desta sessão — reapareceram em Cabo Frio, Araruama, São Pedro da Aldeia ou Iguaba Grande, com `geographic_status` correcto atribuído pelo caminho normal
- 23 (11,1%) permanecem exclusivos do lote histórico, mas já estão em `venues_staging` (só sem `geographic_status`)
- **5 (2,4%) nunca chegaram a `venues_staging`** — o único valor genuinamente fora do alcance do pipeline actual

**Decisão: nenhuma acção neste momento.** Preservar o histórico tal como está — `source_region_label = NULL` significa correctamente "coletado antes da regionalização", uma distinção com valor próprio que uma actualização retroactiva apagaria. O benefício de recuperar 5 registos não justifica alterar dados históricos, aplicar *backfill*, ou qualquer intervenção de código.

**O que isto confirma sobre a arquitectura:** o pipeline regionalizado absorveu naturalmente 86,5% de um legado amplo e não regionalizado, sem nenhuma migração ou script de conversão — o reprocessamento e as coletas normais já fizeram esse trabalho como efeito colateral do seu funcionamento normal.
