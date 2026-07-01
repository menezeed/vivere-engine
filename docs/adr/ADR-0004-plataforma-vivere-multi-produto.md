# ADR-0004 — Plataforma Vivere: engine multi-produto com product_key como dimensão central

**Status:** Aceito
**Data:** 2026-06 (Fase 2)
**Decisores:** Eduardo Menezes

---

## Contexto

Até o final da Fase 1, o projeto era pensado como a engine de ingestão de dados de um único aplicativo: Vida Ativa 60+. Toda decisão de arquitetura partia implicitamente desse contexto único.

## Decisão

**A empresa e a plataforma passam a se chamar Vivere. O app Vida Ativa 60+ (renomeado Vivere 60+) é o primeiro produto de uma plataforma multi-produto.** Produtos futuros (Vivere Família, Kids, Turismo, Cultura, Saúde) usarão a mesma engine sem alteração de código.

Consequências estruturais:
- `product_key` passa a ser campo obrigatório em toda configuração de instância de Collector e de produto do Venue Filtering Engine
- `product_key` é **dimensão de particionamento lógico** — atravessa outras entidades como atributo de filtro, não participa de relacionamentos ricos como `Activity`→`Venue`
- `Venue` deliberadamente **não tem** `product_key` porque um lugar físico é compartilhável entre produtos
- Schema compartilhado com `product_key` (não schemas Postgres separados por produto) — permite reutilização de venues, comparação entre produtos, governança centralizada
- Nomes renomeados: `'vida-ativa-60-mais'` → `'vivere-60-mais'`, pasta `vaip-engine` → `vivere-engine` (pendente no `package.json`)

## Consequências

- Toda a generalização da Fase 2 (Collectors, Venue Filtering Engine) decorre desta decisão
- Adicionar um novo produto Vivere exige apenas arquivos de configuração (`config/`, `products/`) — zero alteração no motor
- A tensão Venue×Product foi resolvida via tabela futura de associação produto-venue, não via coluna direta em `Venue`
