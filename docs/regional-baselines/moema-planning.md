# Planeamento do Regional Baseline — Moema

**Status:** Planeamento concluído
**Depende de:** Brooklin, Campo Belo (Regional Baselines confirmadas), `scaling-risks-analysis-v1.md` (Risco 1 — modelo de visibilidade regional)

---

## Hipótese principal

> O modelo de Regional Baselines continua correcto quando três regiões vizinhas (Brooklin, Campo Belo e Moema) partilham naturalmente o mesmo ecossistema urbano, garantindo que um mesmo venue possa ser descoberto por diferentes regiões sem comprometer a consistência do catálogo publicado.

**Progressão explícita:**
- Brooklin respondeu: "uma região funciona?"
- Campo Belo respondeu: "duas regiões vizinhas funcionam?"
- Moema responde: "o modelo continua a funcionar quando existe sobreposição entre três regiões, não só duas?"

Isto é uma extensão directa do Risco 1 já registado (`scaling-risks-analysis-v1.md`) — Moema é a primeira região onde um venue pode ter sido "reclamado" por qualquer uma de **duas** regiões anteriores diferentes (Brooklin ou Campo Belo), não só uma. É o primeiro teste real de sobreposição não-binária.

## O que será observado, especificamente

- Quantos venues elegíveis vêm exclusivamente de Brooklin
- Quantos vêm exclusivamente de Campo Belo
- Quantos aparecem nas **três** regiões — dado novo, só Moema pode revelar
- Se `ON CONFLICT` por `place_id` continua a produzir exactamente um registo por venue, sem excepção, mesmo com três origens possíveis
- Se `geographic_status` permanece coerente (sempre da primeira região a descobrir, nunca ambíguo)

## Critérios de sucesso

1. O *pipeline* permanece determinístico mesmo com descoberta tripla
2. `ON CONFLICT` continua a garantir unicidade do catálogo, sem excepção
3. A sobreposição observada confirma que o modelo de Regional Baselines continua válido
4. Se surgir comportamento inesperado, gera uma decisão arquitectural por evidência — não por hipótese antecipada

## O que não é hipótese principal, deliberadamente

Densidade de venues, perfil do bairro (Moema é mais residencial de alto padrão que Brooklin/Campo Belo) — informação real, que vai aparecer nas métricas, mas não testa nada novo da arquitectura. Entra como observação secundária, não como critério de encerramento da região.

---

## O que este documento não decide

- Centróide exacto e raio — ver `moema-definicao-operacional.md`
