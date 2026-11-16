# Ensaio de reconstrução a partir das migrações (PGlite, só local)

Apoio ao gate de backup/restore (P0-6) e pré-validação de migrações antes
de as aplicar no staging. Reconstrói a base **do zero** a partir de
`db/migrations`, num PostgreSQL **em memória** (PGlite: PostgreSQL
compilado para WASM, corre dentro do Node). Não precisa de Docker nem de
`psql`, não lê `.env`, não abre ligações de rede e não toca em nenhum
Supabase. Tudo desaparece quando o processo termina.

Script: `scripts/db/rebuild-drill.pglite.mjs` (dependência de
desenvolvimento `@electric-sql/pglite`, versão exacta no `package.json`).

## O que faz

1. Abre um PGlite vazio e aplica `db/audit/local/supabase-sim.sql`.
2. Aplica todas as migrações `NNNN_*.sql` por ordem numérica (ignora
   `*.rollback.sql`) como `postgres` (não superutilizador, como no
   Supabase). Pára na primeira que falhar e diz qual e porquê.
3. Corre `db/audit/grants-audit.readonly.sql` e grava o CSV em
   `runs/rebuild-drill/<data>/` (pasta no `.gitignore`).
4. Ciclo da migração escolhida (`--roundtrip`, por omissão `0028` se
   existir): instantâneo do catálogo + auditoria antes → aplicar →
   testes da migração (para a 0028, `db/audit/api-budget-tests.staging.sql`:
   o relatório vem no `RAISE EXCEPTION` final e é lido; a guarda
   `v_confirm` é preenchida **só na cópia em memória**) → confirmar que os
   testes não deixam resíduo → reaplicar sobre si própria (informativo:
   deve abortar) → rollback → catálogo e auditoria têm de ser **IGUAIS**
   ao estado anterior → reaplicar → **IGUAL** ao estado pós-migração.
5. Imprime o resumo (migrações aplicadas, SHA-256 LF da migração e do
   rollback do ciclo, testes OK/FALHA, rollback IGUAL/DIFERENTE) e grava
   `summary.json`, os instantâneos (`*.snap`) e os CSV na mesma pasta.
   Código de saída 0 = tudo OK; 1 = falha; 2 = erro de uso.

O instantâneo do catálogo cobre todos os schemas não-sistema: schemas e
ACL, extensões, papéis e memberships, tabelas/vistas/sequências, colunas
(tipo, NOT NULL, default, identity), constraints, índices, tipos, ACL de
tabela e de coluna com grantor, funções (dono, security definer,
search_path, md5 do corpo) e respectiva ACL, políticas, triggers,
comentários e default ACL. Não compara dados nem valores de sequências.

## Uso

```
node scripts/db/rebuild-drill.pglite.mjs [--ref <git-ref> | --root <pasta>]
    [--extra <ref>:<caminho>]... [--roundtrip <NNNN|none>] [--out <pasta>]
```

- `--ref` (omissão `HEAD`): lê `db/` desse ref com `git show`, sem checkout.
- `--root`: lê de uma pasta com o layout do repositório.
- `--extra`: sobrepõe um ficheiro de outro ref (ex.: uma migração ainda
  noutra branch), sem a fundir.

Exemplo — cadeia de integração + 0028 de outra branch:

```
node scripts/db/rebuild-drill.pglite.mjs --ref origin/integracao/migrations-p0 \
  --extra <sha>:db/migrations/0028_api_budget.sql \
  --extra <sha>:db/migrations/0028_api_budget.rollback.sql \
  --extra <sha>:db/audit/api-budget-tests.staging.sql
```

Precisa de `db/audit/local/supabase-sim.sql` e
`db/audit/grants-audit.readonly.sql` no ref/pasta indicado. Leva cerca de
1 minuto para 0000→0028.

## Adaptações ao PGlite (só dentro do script, nenhum ficheiro alterado)

| # | Adaptação | Porquê |
|---|---|---|
| A1 | O superutilizador de arranque do PGlite (`postgres`, oid 10) é renomeado para `supabase_admin`. | A simulação cria um `postgres` **não** superutilizador, como no Supabase (onde o superutilizador de arranque é `supabase_admin`). Sem isto o `create role postgres` falharia. |
| A2 | `:"dbname"` (variável do `psql`) da simulação passa a `"postgres"`. | O PGlite não é o `psql`; a base chama-se `postgres`. |
| A3 | `psql -U postgres` → `SET SESSION AUTHORIZATION postgres` antes de cada migração/teste; a auditoria corre também como `postgres`. | O PGlite tem uma única sessão. `session_user` e `current_user` ficam `postgres`, e `RESET ROLE` volta a `postgres`, como no SQL Editor. |
| A4 | Cada ficheiro é enviado numa única mensagem (protocolo simples), não instrução a instrução como o `psql`. | É o comportamento do SQL Editor. Diferença: instruções fora de `begin … commit` num ficheiro que falha são desfeitas em conjunto (o `psql` com autocommit manteria as anteriores). Não afecta ficheiros que passam. |
| A5 | `pg_trgm` (0007) é carregado como extensão contrib do PGlite. | O PGlite só tem as extensões que se lhe passam ao abrir. |

## Limitações (do PGlite / da simulação — não são defeitos das migrações)

- **Versão:** o PGlite usado traz PostgreSQL 18.x; o Supabase corre outra
  versão (a secção `V` da auditoria de cada ambiente mostra-a). Mensagens,
  deparse de expressões e defaults de catálogo podem diferir.
- **Uma única sessão:** não há concorrência real (o `pg_advisory_xact_lock`
  da 0028 executa mas não é exercitado por duas sessões).
- **Simulação mínima do Supabase** (`supabase-sim.sql`, ver
  `db/audit/README.md` §4): sem schemas `extensions`, `graphql`, `vault`,
  `storage`, `realtime`; sem GoTrue nem PostgREST; default ACL e papéis
  simulados.
- **Sem dados:** reconstrói esquema e privilégios, não restaura dados. Para
  o P0-6 isto prova que a cadeia de migrações recria o esquema; o restore
  de dados é um ensaio separado.
- Os testes da 0028 avançam a sequência identity de `staging.api_usage_log`
  mesmo com rollback (as sequências não são transaccionais); o instantâneo
  não compara valores de sequências.
