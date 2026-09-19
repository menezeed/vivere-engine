# Moema — Definição Operacional

**Status:** Etapa 1 concluída — configuração congelada
**Mercado:** Região Metropolitana de São Paulo
**Regra seguida:** centróide escolhido antes de qualquer consulta a venues/resultados

---

## 1. Centróide

**Coordenadas exactas:** -23.60361, -46.66194 (Praça Nossa Senhora Aparecida / Estação Moema)

**Justificativa objectiva:** encontro da Av. Ibirapuera, Av. Moema e Av. Divino Salvador — centro histórico e urbano de Moema, integrado à Estação Moema, posição equilibrada entre os lados "Índios" e "Pássaros" do bairro, suficientemente afastada da fronteira de Campo Belo para não enviesar a escolha.

## 2. Raio inicial

**Valor:** 2.500m — igual ao Brooklin e Campo Belo, deliberadamente.

**Justificação:** comparabilidade directa entre Regional Baselines é mais valiosa do que optimizar cada raio isoladamente. Se um raio diferente se mostrar melhor no futuro, a alteração é feita com evidência acumulada, aplicada a todas as regiões consistentemente — não uma decisão isolada nascida diferente em cada baseline.

## 3. Porquê este centróide/raio

Ligado directamente à hipótese principal de `moema-planning.md`: um centróide geograficamente equilibrado, nem enviesado para a fronteira com Campo Belo nem para os extremos do bairro (Ibirapuera a norte, Congonhas a sul), permite medir a sobreposição tripla (Brooklin/Campo Belo/Moema) sem distorcer o resultado por uma escolha de posição artificial.

## 4. Candidatos considerados e descartados

| Candidato | Motivo da não escolha |
|---|---|
| Parque Ibirapuera | Fica na borda norte de Moema, partilhado com Vila Mariana e Vila Nova Conceição — deslocaria a região artificialmente para norte, aumentando sobreposição com bairros fora do âmbito desta fase |
| Shopping Ibirapuera | Marco comercial específico, não representativo do bairro inteiro — enviesaria a distribuição para um polo comercial em detrimento do conjunto residencial |
| Aeroporto de Congonhas | Próximo geograficamente, mas não representa o bairro — deslocaria o raio para uma área aeroportuária, reduzindo representatividade residencial/comunitária |

**Escolhido:** Praça Nossa Senhora Aparecida / Estação Moema (secção 1).

## 5. Registo de encerramento

| Campo | Valor |
|---|---|
| Coordenadas do centróide | -23.60361, -46.66194 |
| Raio | 2.500m |
| Justificativa | Centro histórico e urbano de Moema, comparável a Brooklin/Campo Belo |
| Referência cartográfica | Google Maps |
| Data da decisão | 2026-08-22 |
| Decidido por | Eduardo |

**Configuração congelada.** Próximo passo: adicionar `moema` a `regions` em `vivere-60-mais.ts`.
