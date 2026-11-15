# Runbook: primeiro fluxo real em STAGING (ingestão → revisão → publicação → Android)

- **Estado:** pronto a executar, **não executado**. A 15/11/2026 o staging nunca recebeu uma ingestão real (`staging.ingestion_runs` = 0) e `public.activities` tem só dados QA.
- **Quem executa:** o PO, ou um operador autorizado por ele, com a chave de serviço do **staging** num ficheiro fora do repositório. Nenhum agente vê a chave.
- **Produção:** fora de âmbito. O `envGuard` recusa-a em todos os comandos abaixo.

## 0. Pré-requisitos
| # | Item | Como verificar |
|---|---|---|
| P1 | Commit do engine com os PRs de integração: arquivo (#20), gate G2 (#23) e datas (#24), se aprovados | `git log` no commit usado; árvore limpa |
| P2 | Papéis nas contas de revisão (`scripts/staging/review-roles.staging.sql`) | E8 sem `(sem papel)` nas contas de revisão |
| P3 | Rollback disponível (`scripts/staging/ingestion-run-rollback.staging.sql`) | testado localmente em PGlite: 10/10 |
| P4 | 0028 aplicada ou não | **não é necessária** para WordPress: as fontes pagas continuam recusadas |

## 1. Ingestão real (uma região de cada vez; começar por `rio_das_ostras`)
1. Pré-voo (sem rede): `npx tsx --env-file=<ficheiro> scripts/run-assisted.ts --region rio_das_ostras --preflight`. Todas as linhas têm de dar `OK`.
2. Dry-run: `npx tsx scripts/run-assisted.ts --region rio_das_ostras --dry-run --since-days=60`.
   - **Referência de 15/11:** cerca de 17 itens, 88% com data, 65% com hora (com o PR #24).
   - Uma diferença grande face a isto → parar.
3. Real: `npx tsx --env-file=<ficheiro> scripts/run-assisted.ts --region rio_das_ostras --since-days=60`.
4. Guardar o `ingestion_run_id` do manifesto (`runs/manifests/`).
5. Verificação só de leitura (o Claude pode fazê-la pelo MCP do staging):
   ```sql
   select status, items_collected, items_errored from staging.ingestion_runs where id = '<run>';
   select count(*) from staging.raw_activity_items where ingestion_run_id = '<run>';
   ```
   - **Critério:** `status` = `success` e contagens iguais às do resumo da execução.

**Rollback** (antes de publicar): `ingestion-run-rollback.staging.sql`, primeiro em simulação e depois com `v_aplicar := true`. A recusa R2 aparece se algo já tiver sido promovido; nesse caso usar o arquivo do publishing.

## 2. Revisão humana
1. Review API local contra o STAGING: `npx tsx --env-file=<ficheiro> src/review-api/server.ts`, com `CORS_ORIGIN` do admin-panel local.
2. Login no admin-panel com a conta `reviewer`/`admin`. Rever as actividades da run: aprovar só as que tenham data e local correctos.
3. Entity Resolution:
   - venues `matched` precisam de decisão humana (gate existente);
   - `proposed_new` **não serão publicadas**, por causa do gate G2: sem venue com coordenadas não se publica.

## 3. Publicação no STAGING
1. `npx tsx --env-file=<ficheiro> src/publishing/publish.ts --product-key=vivere-60-mais --dry-run`, depois `--preview`.
   - O preview mostra `sem local (proposed_new, não publicadas — G2)` e as amostras.
   - **Esperado nesta fase:** a maioria das actividades WordPress fica em `skip_no_location`, porque sem Google Places (L5) há poucos venues com coordenadas. É o comportamento desejado.
2. Só se o preview estiver coerente: `publish.ts --product-key=vivere-60-mais`, sem flags.
3. Verificação só de leitura: `select count(*) from public.activities where engine_activity_id is not null;`

## 4. Android (Pixel, só a app de staging)
1. Na build de staging, definir a localização em Rio das Ostras: as actividades publicadas aparecem; em Niterói e no Rio **não** aparecem (G2).
2. Arquivar uma actividade e confirmar que desaparece no app (correcção do PR #20):
   - `npx tsx --env-file=<ficheiro> scripts/archive-activity.ts --product-key=vivere-60-mais --engine-activity-id=<uuid>` mostra o que seria arquivado;
   - repetir com `--confirm` para arquivar de facto.
3. Evidência: capturas e contagens na Issue #5, sem nomes nem refs.

## 5. Critério de "fluxo real validado"
- [ ] run real `success`, com contagens coerentes com o dry-run;
- [ ] pelo menos 1 actividade revista, aprovada e publicada;
- [ ] visível no Pixel só dentro do raio certo;
- [ ] arquivo reflectido no app;
- [ ] rollback ensaiado numa run de teste, ou justificação de não o fazer.

## 6. Limite conhecido que afecta o volume
Sem venues com coordenadas, o G2 retém quase tudo. Para haver volume em Lagos antes de 15/12 há duas opções:
- **(a)** Google Places para venues, com a 0028 aplicada e um tecto de custo aprovado pelo PO;
- **(b)** curadoria manual de venues com coordenadas no admin, para os locais recorrentes (teatros, centros culturais).

A escolha é do PO, porque (a) tem custo.
