# Integração Engine → app (Lagos, depois Rio e Niterói)

- **Estado:** 15/11/2026. Diagnóstico com medições reais; **nenhuma escrita** em staging ou produção.
- **Objectivo:** ter actividades reais das cidades prioritárias no app até ao go-live de 15/12/2026, sem conteúdo errado nem mal localizado.

## 1. Fluxo
```
fontes WordPress ──run-assisted (E4/E5)──▶ staging.raw_activity_items / activities_staging
        │                                           │
        │                                  Entity Resolution (venues)
        │                                           │
        │                             revisão humana (Review API, SEC-A/B)
        │                                           │
        └──────────────── publish.ts ───────────▶ public.activities ──▶ vista public.active_activities ──▶ app
```
- O app lê só `public.active_activities` com `venues(name, address, lat, lng, phone)` e filtra o raio **no cliente** (`withinRadius`).
- `publish.ts` escreve em `public.activities` só os campos da whitelist ADR-0018 e marca `engine_activity_id`, `source_key`, `product_key`, `engine_status`.

## 2. Estado medido (15/11)
| Item | Facto |
|---|---|
| Ingestão real em staging | **nunca correu**: `staging.ingestion_runs` = 0 linhas |
| `public.activities` no staging | 1060 linhas, **todas QA sintéticas** (`source_key` `qa-lote3`); 0 vindas do engine |
| Contas de revisão no staging | 3 contas, **todas sem `app_metadata.role`** (E8). Com SEC-A, nenhuma consegue rever: 403 |
| Dry-run real (60 dias, commit `b57a945`) | Cabo Frio 9 itens (com data 44%); Búzios 3 (100%); Rio das Ostras 21 (9,5%); São Pedro da Aldeia: HTTP 500 do site municipal após 2 retries |
| Fontes pagas (Google Places) | recusadas até ao L5 (`0028` ainda não aplicada no staging) |

## 3. Lacunas e decisões técnicas
| # | Lacuna | Efeito no app | Tratamento |
|---|---|---|---|
| G1 | Arquivar só marcava `engine_status`; a vista não o filtra | conteúdo retirado continuava visível | **Corrigido sem migration** (PR "arquivar esconde a activity no app"): `archive()` fecha `end_date` |
| G2 | Actividades sem coordenadas passam qualquer raio (`withinRadius` devolve `true` sem `lat/lng`) | uma actividade de Cabo Frio sem local aparece a utilizadores do Rio e de Niterói | **Gate de publicação:** só publicar actividades do engine com venue com coordenadas, até existir resolução de venues (Google Places com L5) ou um filtro por cidade no app. **Por implementar** (PR próprio, antes da primeira publicação real) |
| G3 | Datas: muitas publicações narrativas sem data extraída | sem data não há evento a mostrar; volume útil baixo | PR de melhoria de extracção (precisão primeiro: data errada é pior do que nenhuma) |
| G4 | Nenhuma conta de revisão com papel | o passo de revisão humana fica bloqueado | **PO:** atribuir `viewer`/`reviewer`/`admin` às contas de revisão do staging |
| G5 | Volume real baixo (≈33 itens em 60 dias nas 3 fontes que responderam) | catálogo fino em Lagos | fontes adicionais em `docs/fontes/` (limitações documentadas no PR #16); Google Places depois do L5 com tecto aprovado |
| G6 | `rawItemsErrored` maior do que `rawItemsCollected` no dry-run de Rio das Ostras | métrica enganadora | investigação no PR de extracção |

## 4. Sequência até ao go-live (staging primeiro)
1. **PO:** papéis nas contas de revisão do staging (G4) e execução real assistida por região (runbook E4, chave de serviço do staging fora do repositório).
2. Revisão humana na Review API local ou publicada no staging (SEC-A/B validados localmente: 12/12).
3. `publish.ts --dry-run` → `--preview` → publicação no **staging**; validar no Pixel (build de staging) que as actividades aparecem só no raio certo.
4. Só depois: o mesmo caminho na produção, na janela P0-1 e com autorização própria.

## 5. Fora do âmbito deste documento
Migrations de produção, deploy da Review API, chaves Google e tectos de custo: decisões do PO, ver o pacote P0 no repositório do app.
