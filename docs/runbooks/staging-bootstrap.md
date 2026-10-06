# Runbook — Bootstrap do ambiente STAGING (Vivere)

Estado: rascunho da Activity 16/26 (Phase D), aprovado condicionalmente
pelo Level 2 para versão em repositório. Ainda não validado em execução.

Âmbito: ambientes novos e vazios (staging). NUNCA aplicar à produção
(projecto de produção, ref `ccpqngyupukdefaqvzgl`). Este runbook cobre
o que a cadeia `db/migrations` não consegue versionar em SQL e a ordem
de aplicação. Parar ao primeiro erro e não reparar a meio.

## 1. Pré-verificações

1. Confirmar o projecto: Dashboard no projecto `vivere-staging`, ref
   `jvtcgomwbfojsttepcfc` no URL. Se o ref for o de produção, PARAR.
2. Identidade de cada chave a usar. É local, não toca no Supabase, e
   escreve só o tipo, o `role` e o `ref`, nunca a chave:

```powershell
$sec = Read-Host "Chave a testar (nao e mostrada)" -AsSecureString
$k = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ($k.StartsWith("eyJ")) {
  $p = $k.Split(".")[1].Replace("-","+").Replace("_","/"); while ($p.Length % 4) { $p += "=" }
  $c = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
  $info = "JWT role=$($c.role) ref=$($c.ref)"
} else { $info = "nao-JWT, prefixo $($k.Substring(0,[Math]::Min(3,$k.Length)))" }
$info | Out-File D:\Downloads\key_identity.txt -Encoding utf8
$k = $null
```

   Esperado para a service key: `JWT role=service_role ref=<ref do
   staging>`. Se for `role=anon`, outro ref ou não-JWT, PARAR e esclarecer
   antes de interpretar qualquer teste com chave.

## 2. Ordem de aplicação

```
1  Pré-verificações (secção 1)
2  Migrações 0000 → 0018, uma a uma (0000 é só para ambientes novos)
3  0019_engine_runtime_privileges.sql (um Run) e validação da secção 3
4  0020_security_and_views_baseline.sql e validação por catálogo de RLS,
   políticas, funções e trigger (a definir no gate da Phase E)
4b 0021_venues_staging_geographic_status.sql (um Run) e validação da
   secção 3b
5  Expor o schema staging na Data API (secção 4) e smoke test (secção 5)
6  Dados de referência (secção 6): PENDENTE, ver essa secção
7  Security harness: privilégios temporários, correr, reverter (secção 7)
```

A exposição de `staging` (passo 5) vem depois da `0020` para o schema
ficar exposto já com a postura final de segurança.

## 3. Validação dos privilégios de runtime (só leitura)

Depois da `0019`. Põe os `MISMATCH` primeiro; o esperado é zero.

```sql
select resultado from (
  with grants(rel, privs) as (values
    ('staging.ingestion_runs',              array['SELECT','INSERT','UPDATE']),
    ('staging.venues_staging',              array['SELECT','INSERT','UPDATE']),
    ('staging.activities_staging',          array['SELECT','INSERT','UPDATE']),
    ('staging.venue_resolution_runs',       array['SELECT','INSERT','UPDATE']),
    ('staging.raw_venue_items',             array['SELECT','INSERT']),
    ('staging.raw_activity_items',          array['SELECT','INSERT']),
    ('staging.venue_resolution_decisions',  array['SELECT','INSERT']),
    ('staging.venue_resolution_candidates', array['SELECT','INSERT','UPDATE','DELETE']),
    ('public.venues',                       array['SELECT','INSERT','UPDATE']),
    ('public.activities',                   array['SELECT','INSERT','UPDATE']),
    ('public.publication_runs',             array['SELECT','INSERT','UPDATE']),
    ('public.publication_events',           array['SELECT','INSERT']),
    ('public.products',                     array[]::text[]),
    ('public.sources',                      array[]::text[]),
    ('public.favorites',                    array[]::text[]),
    ('public.activity_interests',           array[]::text[]),
    ('public.suggestions',                  array[]::text[]),
    ('public.partners',                     array[]::text[]),
    ('public.categories',                   array[]::text[]),
    ('public.users',                        array[]::text[]),
    ('public.active_activities',            array[]::text[])
  ), privs(p) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
  select 'service_role ' || g.rel || ' ' || p.p
    || ': esperado=' || (p.p = any(g.privs))::text
    || ' obtido=' || has_table_privilege('service_role'::name, g.rel::text, p.p)::text
    || case when (p.p = any(g.privs)) = has_table_privilege('service_role'::name, g.rel::text, p.p)
            then ' OK' else ' MISMATCH' end as resultado
  from grants g cross join privs p

  union all
  select 'schema USAGE ' || r.rol || ' ' || s.sch
    || ': esperado=' || r.want::text
    || ' obtido=' || has_schema_privilege(r.rol::name, s.sch::text, 'USAGE')::text
    || case when has_schema_privilege(r.rol::name, s.sch::text, 'USAGE') = r.want
            then ' OK' else ' MISMATCH' end
  from (values ('service_role', true), ('anon', false), ('authenticated', false)) as r(rol, want)
  cross join (values ('staging')) as s(sch)

  union all
  select 'service_role schema USAGE public: obtido='
    || has_schema_privilege('service_role'::name, 'public'::text, 'USAGE')::text
    || case when has_schema_privilege('service_role'::name, 'public'::text, 'USAGE')
            then ' OK' else ' MISMATCH' end

  union all
  select 'negativo ' || ro.rol || ' SELECT ' || t.rel || ': obtido='
    || has_table_privilege(ro.rol::name, t.rel::text, 'SELECT')::text
    || case when has_table_privilege(ro.rol::name, t.rel::text, 'SELECT')
            then ' MISMATCH' else ' OK' end
  from (values ('anon'), ('authenticated')) as ro(rol)
  cross join (values ('staging.ingestion_runs'), ('staging.raw_venue_items'),
    ('staging.raw_activity_items'), ('staging.venues_staging'), ('staging.activities_staging'),
    ('staging.venue_resolution_runs'), ('staging.venue_resolution_candidates'),
    ('staging.venue_resolution_decisions')) as t(rel)
) q
order by (resultado like '%MISMATCH%') desc, resultado;
```

Esta query é também a guarda contra deriva: código novo com tabelas ou
verbos novos exige actualizar a `0019` e esta matriz.

### 3b. Validação da 0021 (só leitura)

Depois da `0021`. **Critério PASS/FAIL:** as duas primeiras linhas terminam
em `OK`, o que valida o nome, o tipo, a nulidade e o default da coluna, e o
nome e a definição exatos da CHECK. Qualquer `MISMATCH` é FAIL.

As linhas `info` são só diagnóstico, **NÃO BLOQUEANTES**, e nunca entram no
PASS/FAIL. A posição ordinal da coluna depende do histórico do ambiente: um
apply, rollback e reapply válido dá 15 em vez de 14, porque o PostgreSQL
mantém o espaço da coluna apagada, e o código usa a coluna pelo nome, não
pela posição.

```sql
select facto from (
  select 1 as o,
    'col geographic_status | ' || coalesce(c.data_type || '/' || c.udt_name, 'em falta')
      || ' | nullable=' || coalesce(c.is_nullable, 'n/a')
      || ' | default=[' || coalesce(c.column_default, '') || ']'
      || case when c.data_type = 'text' and c.udt_name = 'text'
               and c.is_nullable = 'YES' and c.column_default is null
              then ' OK' else ' MISMATCH' end as facto
  from (select 1) d
  left join information_schema.columns c
    on c.table_schema = 'staging' and c.table_name = 'venues_staging' and c.column_name = 'geographic_status'
  union all
  select 2,
    'con venues_staging_geographic_status_check | ' || coalesce(pg_get_constraintdef(k.oid), 'em falta')
      || case when pg_get_constraintdef(k.oid) =
              'CHECK (((geographic_status IS NULL) OR (geographic_status = ANY (ARRAY[''inside_radius''::text, ''buffer_zone''::text, ''outside_region''::text]))))'
              then ' OK' else ' MISMATCH' end
  from (select 1) d
  left join pg_constraint k
    on k.conrelid = 'staging.venues_staging'::regclass and k.conname = 'venues_staging_geographic_status_check'
  union all
  select 3, 'info (NAO BLOQUEANTE) ordinal_position=' || coalesce(c.ordinal_position::text, 'n/a')
  from (select 1) d
  left join information_schema.columns c
    on c.table_schema = 'staging' and c.table_name = 'venues_staging' and c.column_name = 'geographic_status'
  union all
  select 4, 'info (NAO BLOQUEANTE) colunas de staging.venues_staging=' || count(*)
  from information_schema.columns where table_schema = 'staging' and table_name = 'venues_staging'
) q order by o;
```

Esperado. As linhas 1 e 2 exatamente; as linhas `info` só como diagnóstico
(o valor da posição pode ser 14 ou 15):

```
col geographic_status | text/text | nullable=YES | default=[] OK
con venues_staging_geographic_status_check | CHECK (((geographic_status IS NULL) OR (geographic_status = ANY (ARRAY['inside_radius'::text, 'buffer_zone'::text, 'outside_region'::text])))) OK
info (NAO BLOQUEANTE) ordinal_position=14
info (NAO BLOQUEANTE) colunas de staging.venues_staging=14
```

## 4. Expor o schema `staging` na Data API

Sem isto, o PostgREST responde `406 PGRST106` ("Invalid schema:
staging") a qualquer pedido do Engine ou da review-api a `staging.*`.
Não é versionável em SQL: a evidência do staging mostra que o `authenticator`
não guarda essa configuração na base de dados.

```
1. Dashboard → projecto vivere-staging (confirmar o ref) → Project
   Settings → API (Data API) → "Exposed schemas". Os nomes dos menus
   mudam entre versões do Supabase: confirmar no ecrã e guardar print
   antes e depois.
2. Manter public e graphql_public, acrescentar staging, Save.
3. NÃO alterar "Extra search path" (o código usa .schema('staging')).
4. Reversão: remover staging da lista.
```

Contingência: se depois de expor e conceder aparecer `PGRST205` (tabela
não encontrada na cache do schema), a cache do PostgREST precisa de
recarregar (`NOTIFY pgrst, 'reload schema'`), só com aprovação.

Mecanismos reproduzíveis (CLI `config.toml`, Management API): candidatos
por verificar na documentação actual do Supabase. Não adoptados.

## 5. Smoke test (só `GET`, nada é escrito)

Corre depois da secção 4. Pede as duas chaves num prompt escondido e
escreve o resultado num ficheiro sem chaves.

```powershell
$ref = "jvtcgomwbfojsttepcfc"
function Read-Key($l) { $s = Read-Host $l -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }
function Who($k) { if ($k.StartsWith("eyJ")) { $p = $k.Split(".")[1].Replace("-","+").Replace("_","/"); while ($p.Length % 4) { $p += "=" }; $c = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json; "JWT role=$($c.role) ref=$($c.ref)" } else { "nao-JWT" } }
function Probe($k, $schema, $table) {
  $h = @{ apikey = $k; Authorization = "Bearer $k"; "Accept-Profile" = $schema }
  $url = "https://$ref.supabase.co/rest/v1/$table`?select=id&limit=1"
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $h; "$schema.$table -> HTTP $($r.StatusCode) $($r.Content)" }
  catch { $resp = $_.Exception.Response; if ($resp) { $b = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd(); "$schema.$table -> HTTP $([int]$resp.StatusCode) $b" } else { "$schema.$table -> erro: $($_.Exception.Message)" } }
}
$sk = Read-Key "Service key do STAGING"; $ak = Read-Key "Anon key do STAGING"
$out = "D:\Downloads\smoketest.txt"
"service: $(Who $sk) | anon: $(Who $ak)" | Out-File $out -Encoding utf8
"--- service_role" | Out-File $out -Append -Encoding utf8
foreach ($c in @(@("staging","ingestion_runs"),@("staging","raw_venue_items"),@("staging","venues_staging"),@("staging","venue_resolution_candidates"),@("public","venues"),@("public","activities"),@("public","publication_runs"),@("public","partners"))) { Probe $sk $c[0] $c[1] | Out-File $out -Append -Encoding utf8 }
"--- anon" | Out-File $out -Append -Encoding utf8
foreach ($c in @(@("staging","ingestion_runs"),@("public","activities"),@("public","venues"))) { Probe $ak $c[0] $c[1] | Out-File $out -Append -Encoding utf8 }
$sk = $null; $ak = $null
```

Esperado:

```
service_role: HTTP 200 com [] nas 7 primeiras (staging.* e public.venues,
  activities, publication_runs). public.partners: 403 com 42501
  (controlo negativo de mínimo privilégio).
anon: staging.ingestion_runs 401 com 42501 (sem USAGE no schema).
  public.activities 200 (controlo positivo da identidade anon).
  public.venues 401 com 42501 (sem GRANT).
```

A primeira escrita real acontece no Engine preview, com dados
sintéticos, noutro gate.

## 6. Dados de referência de `products` e `sources` (PENDENTE)

As FKs de `staging.*` exigem linhas em `public.products` e
`public.sources`, e nenhuma migração nem script do repositório as cria.
Chaves exigidas, lidas em `src/collectors/*/config/*.ts`:

```
product_key: vivere-60-mais
source_key:  google_places, prefeitura_cabo_frio,
             prefeitura_sao_pedro_da_aldeia
             (prefeitura_araruama, marcada "NÃO VALIDADO" na sua config)
```

Os valores de `display_name`, `source_priority` e `source_kind` em
produção são desconhecidos. Não existe um seed canónico e este runbook
não o cria: só deve ser criado depois de reconciliado com a produção
(o que exige uma leitura autorizada à produção).

## 7. Privilégios temporários do security harness

O harness usa `service_role` para criar, ler e apagar fixtures em
`activities`, `venues`, `partners` e `categories`. Esses privilégios não
fazem parte do runtime e não entram em `db/migrations`.

```
Antes do harness:  scripts/staging/harness-test-privileges.sql
Depois do harness: scripts/staging/harness-test-privileges.revert.sql
```

Só no STAGING, nunca na produção. Se a reversão for esquecida, a
validação da secção 3 acusa `MISMATCH`. Limitação conhecida: as 6 relações
legadas sem GRANT para `anon` e `authenticated` (venues, favorites,
activity_interests, suggestions, partners, categories) continuam por
decidir, por isso alguns casos do harness (UPDATE em venues, partners e
categories, DELETE em activities, admin UPDATE em venues) negam ou falham
por falta de GRANT e não por RLS. Não os usar como evidência de RLS até
essa decisão.

## 8. Dívida de hardening registada

`service_role` tem `BYPASSRLS` e mantém `TRUNCATE` herdado do default ACL,
inclusive em `staging.raw_*`. A `0019` não concede `UPDATE` nem `DELETE`
nessas tabelas, mas enquanto `TRUNCATE` permanecer concedido isso NÃO
torna o *append-only* absoluto. Fica por decidir à parte (revogar
`TRUNCATE`, `TRIGGER`, `REFERENCES` e `MAINTAIN` a `anon`,
`authenticated` e `service_role`), com revisão Level 2 e sem alterar
privilégios existentes em produção sem autorização própria.
