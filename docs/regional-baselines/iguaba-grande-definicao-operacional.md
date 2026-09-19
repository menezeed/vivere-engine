# Iguaba Grande — Definição Operacional

**Status:** Etapa 1 concluída — configuração congelada
**Mercado:** Região dos Lagos, RJ
**Regra seguida:** centróide escolhido antes de qualquer consulta a venues/resultados

---

## 1. Centróide

**Coordenadas exactas:** -22.839561, -42.220774

**Justificativa objectiva:** ponto central da cidade, confirmado directamente no Google Maps.

## 2. Raio inicial

**Valor:** 4.000m — mesmo critério de São Pedro da Aldeia, distinto dos 12.000m usados em Cabo Frio/Araruama.

**Justificação:** cidade pequena da Região dos Lagos. Raio conservador por desenho — preferência por precisão a cobertura excessiva; ajuste futuro baseado em evidência do *dry-run*, não em suposição.

## 3. Porquê este centróide/raio

Mesmo raciocínio de São Pedro da Aldeia: escolha conservadora, ajuste posterior com dados reais.

## 4. Candidatos considerados e descartados

Não aplicável nesta ronda — mesmo critério de São Pedro da Aldeia.

## 5. Registo de encerramento

| Campo | Valor |
|---|---|
| Coordenadas do centróide | -22.839561, -42.220774 |
| Raio | 4.000m |
| Justificativa | Cidade pequena; raio conservador, mesmo critério de São Pedro da Aldeia |
| Referência cartográfica | Google Maps |
| Data da decisão | 2026-08-21 |
| Decidido por | Eduardo |

**Configuração congelada.** Próximo passo: adicionar `iguaba_grande` a `regions` em `vivere-60-mais.ts`, junto com `sao_pedro_da_aldeia`.
