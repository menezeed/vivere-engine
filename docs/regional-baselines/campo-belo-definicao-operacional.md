# Campo Belo — Definição Operacional

**Status:** Etapa 1 do Regional Expansion Checklist — por preencher
**Regra seguida:** centróide escolhido antes de qualquer consulta a venues/resultados — evita viés de "ajustar o ponto para melhorar os dados"

---

## 1. Centróide

**Coordenadas exactas:** _(lat, lng — a preencher, confirmadas directamente no Google Maps)_

**Justificativa objectiva:** _(porque este ponto — referência urbana reconhecida, não "está mais perto de X venue")_

## 2. Raio inicial

**Valor:** _(mesmo critério do Brooklin — 2.500m — salvo razão objectiva registada aqui para alterar)_

**Se diferente de 2.500m, porquê:** _(razão geográfica/urbana, nunca "para caber mais/menos resultados")_

## 3. Porquê este centróide

_(baseado na geografia urbana e na hipótese do experimento — ligar explicitamente à Hipótese Principal do `campo-belo-planning.md`: este ponto ajuda a testar a sobreposição com o Brooklin de forma clara, nem a maximizando nem a evitando artificialmente)_

## 4. Hipótese a testar

Reafirmada de `campo-belo-planning.md`: **o modelo de Regional Baselines continua correcto quando duas regiões vizinhas partilham naturalmente parte do mesmo ecossistema urbano?**

## 5. Candidatos considerados e descartados

_(preencher à medida que forem avaliados no Google Maps — o objectivo é que "porquê este ponto e não outro" fique respondido aqui, não na memória de quem decidiu)_

| Candidato | Motivo da não escolha |
|---|---|
| | |
| | |

**Escolhido:** _(referência ao ponto final, secção 1)_

## 6. Registo de encerramento

| Campo | Valor |
|---|---|
| Coordenadas do centróide | |
| Raio | |
| Justificativa | |
| Referência cartográfica (captura/link do Google Maps) | |
| Data da decisão | |
| Decidido por | |

**Depois de preenchido e confirmado, esta configuração fica congelada para o experimento — mesmo tratamento que o Brooklin recebeu.** Só depois disto é que `--region=` é adicionado a `vivere-60-mais.ts` (mesmo diff simétrico já usado para o Brooklin).
