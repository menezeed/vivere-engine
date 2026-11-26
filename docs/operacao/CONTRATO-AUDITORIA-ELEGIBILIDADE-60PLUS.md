# Contrato frontend — auditoria de elegibilidade 60+ de Richmond

**Estado:** fixture informativa versionada, derivada somente do relatório revisto no PR #61. Não é decisão de aprovação/publicação nem garantia de disponibilidade ou preço atual.

## Fonte e identidade
- Dataset: `admin-panel/src/data/richmond-eligibility.json`, schema v1, 133 itens, produto `vivere-60-plus-uk-test`, fonte `u3a_richmond`.
- Fonte: `docs/operacao/AUDITORIA-60PLUS-RICHMOND.md`, commit `68737b5`, verificada em 2026-11-26. `reportOrdinal` é apenas rastreabilidade.
- O relatório não contém `source_item_id`; a chave estável é `canonicalSourceUrl`, associada a `ActivityStagingItem.external_url` disponibilizado pela Review API. Os 133 URLs do relatório são HTTPS, não vazios e únicos após normalização.
- Normalizar somente host para lowercase e remover query, fragmento e slash final. Só aceitar HTTPS no host `rut.u3asite.uk`. Não usar título, ordinal, UUID de staging ou substring como fallback.
- URL ausente/inválida, duplicada ou não correspondente falha fechado: mostrar “Não confirmado” e não associar evidência. O aceite visual deve confirmar em leitura que os 133 `external_url` do staging correspondem ao snapshot; este fixture não prova que staging não mudou.

## Campos e semântica
| Campo | Contrato de exibição |
|---|---|
| `eligibilityClass` | `confirmed_60plus`: “60+ confirmado”; `likely_suitable`: “Provavelmente adequada”; `unclear`/sem match: “Não confirmado”; `unsuitable`: “Inadequada”. |
| `confidence`, `evidenceSummary`, `canonicalSourceUrl`, `checkedAt` | Mostrar confiança, justificação parafraseada, link de fonte e data. |
| `eligibilityScope` | “not_confirmed” em todos: o relatório não fixa se a atividade é exclusiva para 60+ ou aberta a 60+. Renderizar “Não confirmado”; não inferir. |
| `participation.membershipRequired`, `membershipFeeNote` | Mostrar condição de membro e nota de quota conforme a evidência. Quota da associação ≠ preço da atividade. |
| `additionalCost` | `reported` apresenta texto citado; `not_indicated` apresenta “Custo adicional não indicado na fonte”, nunca “Gratuito”; `not_confirmed` apresenta “Não confirmado”. |
| `availability` | Estado do snapshot com data: aberto, cheio/lista de espera, fechado ou evento único/vagas desconhecidas. Não anunciar como disponibilidade atual. |
| `schedule`, `location` | O relatório não fornece valores detalhados estruturados. Mostrar “Não confirmado”; usar “Horário incompleto”/“Local genérico” quando indicado. Não fabricar. |
| `recommendation` | Texto editorial, nunca decisão ou comando. |

A quota global oficial é separada do custo de cada atividade, foi verificada em 26/11 e informada válida até 01/09/2027. Revalidar antes de apresentá-la como atual. Ausência de custo reportado não significa gratuidade.

## Leitura e segurança
- Combinar o JSON versionado com os itens do endpoint autenticado/read-only da Review API. Não consultar Supabase diretamente no browser nem usar service-role.
- Os 133 continuam `pending_review`. Classificação não aprova, rejeita, promove nem publica.
- Desabilitar na UI approve/promote para `likely_suitable`, `unclear` e `unsuitable` enquanto não existir fluxo distinto autorizado. Isso não substitui RBAC/decisão server-side; este contrato não cria permissões.
- Se o fixture falhar a carregar ou validar, manter a listagem, indicar auditoria indisponível/não confirmada e não ampliar ações.

## Cobertura focada
Fixture: 133 itens, distribuições 1/124/7/1 e 94/33/5/1, URLs canônicas únicas, normalização, ausência de fallback por título, rejeição de duplicatas e comportamento fail-closed para campos ausentes. A paginação 1/7→7/7 já aprovada no PR #61 não será repetida.
