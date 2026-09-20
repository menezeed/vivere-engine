# AI Development Workflow — Vivere Platform

**Status:** Adotado
**Data:** 2026-09-18

---

## Objetivo

Reduzir Eduardo a decisor, não a ponte operacional entre IAs. Claude e ChatGPT devem investigar, implementar e revisar de forma autónoma sobre uma base verificável comum (GitHub) — Eduardo só entra quando existe uma decisão real por tomar, não para transportar mensagens entre as duas.

## Hierarquia de verdade

Nenhuma IA decide arquitetura com base na opinião da outra IA. Ordem de autoridade, da mais alta para a mais baixa:

1. **Código, testes, dados reais** — o que o sistema realmente faz, comprovado por execução
2. **Documentação aprovada** — ADRs, Engineering Principles, Architecture Book
3. **Evidência experimental** — resultado de investigação nova, ainda não documentada
4. **Análise das IAs** — opinião, hipótese, recomendação

Se um teste ou o código já demonstra qual das duas IAs está correta, isso não sobe para Eduardo — resolve-se pela evidência, não por autoridade de quem disse o quê.

## Os três níveis

```
NÍVEL 1 — AUTOMÁTICO
Claude Code
   ↓
Issue → implementação → testes → PR
   ↓
CI / validações objetivas
   ↓
correções técnicas

NÍVEL 2 — REVISÃO
ChatGPT / revisão arquitetural
   ↓
compatibilidade com Architecture Book, ADRs,
Engineering Principles, schema, testes, regressões
   ↓
APROVADO ou CHANGES REQUESTED

NÍVEL 3 — EDUARDO
Somente quando houver um dos gatilhos abaixo
```

## Gatilhos que exigem decisão de Eduardo

1. **Custo real** — qualquer coisa que gaste dinheiro (API paga, infraestrutura nova)
2. **Mudança de escopo/arquitetura** — abrir uma ADR nova, ou decidir entre hipóteses registadas sem critério de aceitação já cumprido
3. **Trade-off de produto** — decisões sobre o que o produto deve fazer, não sobre como o código deve funcionar
4. **Ação destrutiva ou irreversível** — apagar dados, publicar em massa, mudar schema de produção
5. **Divergência entre Claude e ChatGPT que não se resolve com evidência** — se, depois de as duas investigarem o mesmo código/dados reais, ainda discordarem, sobe para Eduardo; não deveria acontecer com frequência, já que o código é árbitro
6. **Mudança de contrato de dados** — alterar o significado ou formato de um campo já em uso (ex: o que `occurrences` significa, se `day_of_week` passa a fazer parte do contrato publicado) sobe sempre, porque atravessa Engine, Admin, banco e Mobile ao mesmo tempo

**Fora destes seis, nenhuma IA precisa de aprovação prévia de Eduardo** para investigar, corrigir, ou propor — só para agir quando o gatilho disparar.

## Formato de "Decision Required", quando um gatilho dispara

```
Decision required — <título curto>

Evidência: <o que foi encontrado, com referência a código/dados reais>
Impacto atual: <o que está a acontecer hoje por causa disto>
Opção A: <...>
Opção B: <...>
Recomendação técnica: <opinião das IAs, claramente marcada como opinião>
Consequências: <o que cada opção implica>

Eduardo precisa decidir: A ou B.
```

Curto, sem prescrever a solução antes de Eduardo decidir entre as opções reais.

## GitHub como fonte única de verdade

- `/docs`, ADRs, Engineering Principles — já existentes, continuam a ser a base
- **Issues** — achados, investigações, decisões pendentes (tipo `bug`/`investigation` quando ainda não há solução decidida, não prescrever a correção antes de investigar)
- **Pull Requests** — implementação, com CI a correr testes

## Nota sobre configuração

Este documento descreve o fluxo-alvo. A automação completa (Claude a responder a menções `@claude` em issues/PRs automaticamente) depende de configurar o Claude Code / GitHub App no repositório — uma superfície diferente do chat usado para desenhar este workflow. Ver `https://docs.claude.com` para os passos de configuração exactos no momento da implementação.
