# São Pedro da Aldeia — Definição Operacional

**Status:** Etapa 1 concluída — configuração congelada
**Mercado:** Região dos Lagos, RJ
**Regra seguida:** centróide escolhido antes de qualquer consulta a venues/resultados

---

## 1. Centróide

**Coordenadas exactas:** -22.835174, -42.098698

**Justificativa objectiva:** ponto central da cidade, confirmado directamente no Google Maps.

## 2. Raio inicial

**Valor:** 4.000m — deliberadamente conservador, distinto dos 12.000m usados em Cabo Frio/Araruama.

**Justificação:** São Pedro da Aldeia é significativamente menor que Cabo Frio e Araruama. Copiar o raio de 12km arriscaria sobreposição forte com Cabo Frio, geograficamente próxima na Região dos Lagos. Preferência por precisão a cobertura excessiva — mais fácil aumentar de 4→5→6km com evidência do que descobrir depois que 12km captou meio mercado de uma vez.

## 3. Porquê este centróide/raio

Mesma filosofia já aplicada em Campo Belo: escolha conservadora, ajuste posterior baseado em dados do *dry-run*, nunca em suposição. O ajuste do raio (se necessário) segue o mesmo processo já validado: `dry-run` → distribuição `inside_radius`/`buffer_zone`/`outside_region` → decisão com evidência.

## 4. Candidatos considerados e descartados

Não aplicável nesta ronda — decisão de raio tomada por critério de mercado (cidade menor → raio menor), não por comparação de múltiplos pontos centrais como em Campo Belo. Centróide confirmado directamente no Google Maps sem alternativas avaliadas.

## 5. Registo de encerramento

| Campo | Valor |
|---|---|
| Coordenadas do centróide | -22.835174, -42.098698 |
| Raio | 4.000m |
| Justificativa | Cidade menor; raio conservador para minimizar sobreposição com Cabo Frio |
| Referência cartográfica | Google Maps |
| Data da decisão | 2026-08-21 |
| Decidido por | Eduardo |

**Configuração congelada.** Próximo passo: adicionar `sao_pedro_da_aldeia` a `regions` em `vivere-60-mais.ts`, junto com `iguaba_grande`.
