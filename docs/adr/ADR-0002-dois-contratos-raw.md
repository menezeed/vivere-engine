# ADR-0002 — Duas fontes, dois contratos: RawVenueItem vs RawActivityItem

**Status:** Aceito
**Data:** 2026-06 (Fase 1)
**Decisores:** Eduardo Menezes

---

## Contexto

O Google Places API retorna lugares físicos; a Prefeitura de Cabo Frio retorna notícias sobre eventos. Era tentador usar um único contrato de saída para os dois Collectors ("um RawItem genérico"), ou fazer o contrato de atividade carregar também os dados completos do venue (coordenadas, telefone, website) já que a atividade "acontece em algum lugar".

## Decisão

**Dois contratos separados, com autoridade epistêmica distinta:**

- `RawVenueItem` — para fontes com autoridade sobre *lugares* (Google Places, fontes geoespaciais). Pode carregar `lat`/`lng`/`phone`/`website` porque a fonte tem autoridade para afirmar isso.
- `RawActivityItem` — para fontes com autoridade sobre *eventos* (prefeituras, portais de agenda). Carrega `venue_mention` (texto + confidence_hint), nunca campos completos de venue, porque a fonte não tem autoridade epistêmica para afirmar coordenadas ou telefone de um lugar que ela apenas menciona.

## Consequências

- `VenueMention` nasceu como estrutura embutida em `RawActivityItem`, não como entidade separada — resultado direto desta decisão (Fase 3, ajuste de contrato)
- Os seis campos antigos (`venue_name`/`venue_address`/`venue_lat`/`venue_lng`/`venue_phone`/`venue_website`) em `RawActivityItem` foram reconhecidos como violação desta decisão e removidos na Fase 3 antes do primeiro schema real
- `RawVenueItem` e `VenueMention` nunca devem ser confundidos: um é autoridade, o outro é afirmação textual
