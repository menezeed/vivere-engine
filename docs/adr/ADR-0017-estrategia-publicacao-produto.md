# ADR-0017 — Estratégia de Publicação por Produto

**Status:** Aceito
**Data:** 2026-07-08

---

## Decisão

**Um único Publishing Engine com filtro por `product_key`.**

O comando `publish.ts --product-key=vivere-60-mais` publica apenas os dados
do produto especificado. O engine nunca publica dados de múltiplos produtos
numa única run — uma run, um produto.

Isto é idêntico à estratégia do Entity Resolution Engine
(`run.ts --product-key=vivere-60-mais`).

### Isolamento entre produtos

public.venues e public.activities contêm registos de múltiplos produtos
(legacy UK + Cabo Frio + futuros). O `product_key` é o discriminador.

O app filtra por product_key nas suas queries. O Publishing Engine filtra
por product_key em todas as suas queries de staging.

### Extensão futura

Adicionar São Paulo: `publish.ts --product-key=vivere-sp-capital`
Adicionar UK: `publish.ts --product-key=vivere-60-plus-uk`
Zero alteração no engine — apenas novo product_key.
