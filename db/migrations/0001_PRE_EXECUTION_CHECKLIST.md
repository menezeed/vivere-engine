# Checklist de pré-execução — `0001_phase3_domain_model.sql`

Cada item abaixo foi verificado de forma mecânica (parser SQL real em dialeto Postgres, `sqlglot`), não por leitura manual — onde a verificação automática não foi possível, isso está marcado explicitamente como tal.

---

## 1. Tabelas que serão criadas (11)

| Schema | Tabela | Camada |
|---|---|---|
| `public` | `products` | Configuração |
| `public` | `sources` | Configuração |
| `staging` | `ingestion_runs` | Operacional |
| `staging` | `raw_venue_items` | Camada A — dado bruto |
| `staging` | `raw_activity_items` | Camada A — dado bruto |
| `staging` | `venues_staging` | Camada B — staging |
| `staging` | `activities_staging` | Camada B — staging |
| `public` | `venues` | Camada C — consolidado |
| `public` | `venue_contributions` | Camada C — consolidado |
| `public` | `activities` | Camada C — consolidado |
| `public` | `activity_source_links` | Camada C — consolidado |

Mais: 1 schema novo (`staging`), 4 índices, 2 `ALTER TABLE` (adição de FK de promoção).

**Status: ✅ confirmado** — contagem extraída via parser, não contada manualmente.

---

## 2. Nenhuma tabela `public.*` pré-existente é alterada

- Busca por `DROP`, `UPDATE`, ou `ALTER TABLE` sobre qualquer tabela não criada nesta mesma migration: **nenhuma ocorrência**.
- Os 2 únicos `ALTER TABLE` do arquivo (`venues_staging`, `activities_staging`) são sobre tabelas criadas linhas acima, na mesma migration.
- Nenhum outro arquivo `.sql` existe no repositório — não há schema legado neste projeto que pudesse colidir.

**Status: ✅ confirmado, com uma ressalva real** — esta migration nunca foi executada contra um banco real (Supabase ou outro). A confirmação acima é sobre o conteúdo do arquivo, não sobre o estado do banco de destino. **Antes de aplicar, rode manualmente** (fora desta revisão, contra o ambiente alvo real):
```sql
select schemaname, tablename from pg_tables where schemaname in ('public', 'staging');
```
Se `staging` já existir, ou se qualquer uma das 11 tabelas acima já existir em `public`, **pare e investigue antes de aplicar** — esta migration não tem `if not exists` em `create table` (de propósito, para falhar ruidosamente em vez de silenciosamente ignorar uma colisão).

---

## 3. Nenhum trigger de promoção automática

Busca por `CREATE TRIGGER`, `CREATE FUNCTION`, `CREATE PROCEDURE`: **nenhuma ocorrência executável** (a única menção à palavra "trigger" está dentro de um comentário SQL, explicando o princípio).

A migration cria apenas estrutura passiva — tabelas, constraints, índices. Nenhum mecanismo no banco é capaz de mover dado de staging para produção sozinho; isso exigiria uma função de promoção ainda não escrita, chamada deliberadamente por uma aplicação ou um humano.

**Status: ✅ confirmado.**

---

## 4. `raw_*` é append-only

Verificado estruturalmente: `staging.raw_venue_items` e `staging.raw_activity_items` têm `created_at`, **nenhuma das duas tem `updated_at`** ou qualquer outra coluna desenhada para edição.

**Status: ⚠️ confirmado em design, não garantido pelo banco.** Isto é uma lacuna real que vale registrar com clareza: a ausência de `updated_at` é um sinal de intenção, não uma trava. Hoje, qualquer papel/role com permissão de `UPDATE`/`DELETE` nestas tabelas ainda poderia tecnicamente alterá-las — o banco não impede isso por si só. Para fechar essa lacuna antes ou logo depois da primeira aplicação, recomendo (não incluído nesta migration, para não misturar escopo):
- Uma policy de RLS (Row-Level Security) que bloqueie `UPDATE`/`DELETE` nas duas tabelas `raw_*` para todo papel exceto, no máximo, um papel administrativo de emergência.
- Alternativa mais simples: revogar `UPDATE`/`DELETE` da role de aplicação nessas duas tabelas especificamente (`REVOKE UPDATE, DELETE ON staging.raw_venue_items, staging.raw_activity_items FROM <role_da_aplicacao>`).

## 5. `proposal_status` começa como `pending_review`

`staging.venues_staging.proposal_status`: `default 'pending_review'` ✅
`staging.activities_staging.proposal_status`: `default 'pending_review'` ✅

Os 2 índices parciais (`idx_venues_staging_pending_review`, `idx_activities_staging_pending_review`) reforçam essa fila como caminho de consulta otimizado.

**Status: ✅ confirmado** — extraído via parser, as duas únicas ocorrências de `proposal_status` na migration têm o mesmo default.

---

## 6. Integridade de Foreign Keys

20 FKs no total (18 inline + 2 via `ALTER TABLE` para resolver as referências "para frente" `promoted_venue_id`/`promoted_activity_id`). Todas verificadas automaticamente contra o conjunto de tabelas criadas: **nenhuma FK órfã**, ordem de criação respeita toda dependência.

**Status: ✅ confirmado.**

---

## 7. Plano de rollback

Criado: `0001_phase3_domain_model.rollback.sql`, na mesma pasta da migration.

- Remove as 11 tabelas em ordem inversa de dependência de FK (mais dependentes primeiro).
- Cobertura verificada por comparação automática de conjuntos contra a migration original: **as tabelas removidas pelo rollback são exatamente as tabelas criadas pela migration — nem mais, nem menos**.
- Remove o schema `staging` ao final.
- `DROP TABLE ... CASCADE` é usado deliberadamente, para que a ordem de remoção não precise ser perfeitamente manual em caso de dependência não prevista — mas isso também significa que rodar o rollback **é destrutivo e apaga qualquer dado já inserido**, não só a estrutura.

**Status: ✅ existe, validado sintaticamente.** ⚠️ Nunca rode este rollback contra um ambiente com dado real que você queira preservar, sem backup prévio — ele não distingue "tabela vazia" de "tabela com semanas de coleta real".

---

## Resumo executivo

| # | Item | Status |
|---|---|---|
| 1 | Checklist gerado | ✅ este documento |
| 2 | Tabelas confirmadas | ✅ 11, listadas acima |
| 3 | Nenhuma tabela `public.*` existente alterada | ✅ no arquivo — ⚠️ confirme manualmente contra o banco real antes de aplicar |
| 4 | Nenhum trigger de promoção automática | ✅ |
| 5 | `raw_*` append-only | ✅ por design — ⚠️ sem trava de banco ainda (RLS/REVOKE recomendados como próximo passo) |
| 6 | `proposal_status` inicia `pending_review` | ✅ |
| 7 | FKs corretas | ✅ 20 FKs, todas resolvidas |
| 8 | Rollback existe | ✅ criado nesta revisão |

## Antes de aplicar em dev

1. Rodar a query de `pg_tables` acima contra o ambiente dev real, confirmar zero colisão.
2. Aplicar `0001_phase3_domain_model.sql`.
3. Confirmar visualmente, no painel do Supabase (ou via `\dt staging.*` / `\dt public.*`), que as 11 tabelas existem com os nomes esperados.
4. **Não aplicar em produção** até pelo menos um ciclo de uso real em dev (alguns `IngestionRun` reais, ao menos uma promoção manual de teste) validar o modelo na prática, não só na revisão de schema.
