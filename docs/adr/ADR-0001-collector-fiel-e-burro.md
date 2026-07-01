# ADR-0001 — Separação entre Collector e Pipeline: Collector é fiel e burro

**Status:** Aceito
**Data:** 2026-06 (Fase 1)
**Decisores:** Eduardo Menezes

---

## Contexto

Ao desenhar a primeira versão do `GooglePlacesCollector`, surgiu a questão de onde colocar a lógica de "este venue é relevante para o produto?". Havia dois caminhos: (a) o Collector já filtra e decide no momento da busca, retornando só o que considera relevante; (b) o Collector coleta tudo que a API retornar e delega qualquer julgamento de relevância para um estágio posterior do pipeline.

## Decisão

**O Collector nunca toma decisões de negócio.** Sua única responsabilidade é: chamar a fonte, normalizar mecanicamente o payload (trim, encoding), e retornar um contrato (`RawVenueItem` ou `RawActivityItem`) que é uma fotografia fiel do que a fonte disse — sem nenhuma interpretação, sem nenhum filtro, sem nenhuma inferência.

Frases que capturam a decisão: "Collector é fiel e burro". "Nenhuma interpretação de negócio acontece aqui."

## Consequências

- O Venue Filtering Engine nasceu como estágio separado (`pipeline/stages/00-filter-venue/`) — uma consequência direta desta decisão
- `raw_payload` se tornou campo obrigatório em ambos os contratos — o dado bruto original é sempre preservado para auditoria, independente do que os estágios posteriores decidirem
- Testes de Collector nunca precisam saber se um venue é "aceito" ou "rejeitado" — essa verificação pertence aos testes do Venue Filtering Engine
- Generalizações posteriores (Fase 2) foram facilitadas porque os Collectors não carregavam lógica de negócio que precisaria ser extraída
