# Regional Expansion Playbook v1

Fluxo operacional confirmado por duas execuções reais (Brooklin, Campo Belo). Não é uma proposta — é o que aconteceu, documentado para repetição.

```
1. Definição operacional (sem código)
   → centróide + raio, candidatos descartados com motivo
   → docs/regional-baselines/<região>-definicao-operacional.md

2. Adicionar região a regions[] em vivere-60-mais.ts
   → key, display_label, lat, lng, radius_m (2.500 por omissão)

3. npx tsc --noEmit
   → parar aqui se falhar

4. Dry-run (tem custo, ~USD 2)
   npx tsx --env-file=.env scripts/dry-run-google-places.ts --region=<key>
   → confirmar cabeçalho: região certa, 7 queries
   → verificação rápida, não exaustiva: config correcta? queries fizeram sentido?
     distribuição geográfica plausível? alguma anomalia óbvia (homónimo,
     erro de execução)?

5. Se dry-run limpo → ingestão real (custo semelhante ao dry-run)
   npx tsx --env-file=.env scripts/ingest-google-places.ts --region=<key>
   → confirmar staged/rejected/geoExcluded no resumo

6. Snapshot de métricas
   → docs/regional-baselines/<região>-metrics-snapshot.md
   → mesmas 8 métricas sempre, incluindo sobreposição com regiões já
     existentes (query SQL por ingestion_run_id)

7. Comparação com a Regional Baseline (Brooklin)
   → as percentagens batem com o padrão já visto, ou há desvio a explicar?

8. Conclusão
   → região tratada como validação rotineira, a menos que apareça
     comportamento genuinamente fora do padrão
```

## Regra de profundidade, a partir da 3ª região

Brooklin e Campo Belo já estabeleceram a metodologia. Investigação profunda (como a destas duas) só se justifica se aparecer:
- Sobreposição muito acima ou abaixo do intervalo já observado (~20-30%)
- Distribuição geográfica anómala face ao padrão
- Erro de execução ou configuração
- Problema de qualidade de dados não já catalogado (ver Backlog Técnico dos *snapshots* anteriores)

Caso contrário: dry-run → ingestão → *snapshot* → seguir em frente, sem relatório de síntese por região.

## O que NÃO repetir a cada região

- Não reabrir a hipótese principal (já respondida em `regional-baseline-report-v1.md`) — só actualizar o número de sobreposição se relevante
- Não reescrever `campo-belo-planning.md`-style com hipóteses novas, a menos que a região revele algo genuinamente distinto
- Não gerar um Mini PR por região — só se a região expuser um bug ou lacuna real, como aconteceu no Brooklin
