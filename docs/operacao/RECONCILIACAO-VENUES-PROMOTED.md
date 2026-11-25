# Reconciliação dos 53 `venues_staging` promoted sem `promoted_venue_id` (produção, 25/11/2026)

**Contexto:** Issues #53 (limpeza) e #52 (baseline do catálogo).

**O que este documento é:**
- só análise e plano;
- não houve publicação, migração, UPDATE/DELETE nem alteração de RLS;
- **não se restauram os 57 locais** (decisão do PO).

## 1. Baseline confirmada da produção (25/11)
| Item | Valor | Fonte |
|---|---|---|
| `public.venues` | **24**, todos com actividade (0 órfãos) | SQL do PO (#53, 18:00Z) + GET anon (Claude) |
| `public.activities` | **48** (sem alterações) | idem |
| `public.venues` por origem | 19 `legacy`, 5 `google_places` (os 5 com `engine_venue_id`) | GET anon, 25/11 |
| `staging.venues_staging` (no projecto de produção) | 494; **5** com `promoted_venue_id`; **53** `proposal_status='promoted'` com `promoted_venue_id IS NULL` | SQL do PO (#53) |
| "Yoga no Forte – Edição de setembro" | **existe** (`2309e3f8-…`, `active`, `prefeitura_cabo_frio`; é a única actividade com `engine_activity_id`) | GET anon, 25/11 |
| RLS de `venues` | sem alteração (SELECT público; `admin_role_all`) | SQL do PO |

O backup v5 de 23/11 (81 locais) é **histórico**, não a verdade actual.

**Sobre a "Yoga no Forte":** o DELETE pelo admin legado devolveu uma lista vazia porque a política de escrita exige `app_metadata.role=admin` **no token do projecto de produção**. O RLS filtrou a linha, a actividade continua lá e nenhuma alteração é proposta.

## 2. Risco de recriação pelo Publishing Engine (verificado no código)
**Selecção:** `PublishableVenueRepository.findUnpublished()` escolhe, em `staging.venues_staging`:

```
proposal_status = 'promoted'
AND (geographic_status IS NULL OR geographic_status <> 'outside_region')
AND promoted_venue_id IS NULL
```

**Execução:** `VenuePublisher.buildInsertDecision()` decide **`insert` sem nenhuma verificação prévia**. Não chama `findByEngineId` nem consulta `publication_events`. `executeDecision('insert')` faz:
1. `public.venues.insert(... engine_venue_id = staging id)`;
2. `linkToStaging()`;
3. o evento `VenuePublished`.

A restrição `UNIQUE (public.venues.engine_venue_id)` já **não protege**, porque os locais foram apagados.

**Consequência:** a próxima execução real de `publish.ts` sobre a produção **voltaria a criar até 53 locais** (os que não estão `outside_region`), sem actividades, e voltaria a ligá-los. Isto desfaz a limpeza do #53 em silêncio. O `--preview` mostrá-los-ia como "novos".

**Efeito nas actividades** (`PublishableActivityRepository.enrichWithPublicVenueIds`): uma actividade `promoted` cujo `resolved_venue_staging_id` seja um dos 53 **perde o mapeamento do local**. Seria publicada com `venue_id = null` (insert), ou o local seria anulado num dirty update.

**Probabilidade hoje: BAIXA.**
- `publish.ts` usa `getSupabaseClient()`, e o `envGuard` (SEC-O) **bloqueia a produção** (`PRODUCTION_BLOCKED`). Com o código actual, o publish só corre no staging.
- O risco torna-se real se:
  - o guard for alterado ou contornado;
  - uma versão antiga, anterior aos guards, correr contra a produção (`publication_runs`: 8 execuções históricas na produção);
  - a Fase 3 da #52 (publicação para o catálogo) for activada sem esta reconciliação.

**Impacto se acontecer: ALTO.** Desfaz a limpeza aprovada, gera locais órfãos e quebra a rastreabilidade.

## 3. Diagnóstico pendente (consultas SÓ SELECT, para o PO correr no SQL Editor da produção)
O Claude não tem acesso SQL à produção. As consultas não alteram nada.

### 3.0 Protocolo de execução só de leitura (25/11)
- **Quem corre:** o PO, no SQL Editor do projecto de **produção**. O Claude não tem canal SQL para a produção e não o usa.
- **Antes de correr, confirme que o texto é só leitura:**
  - procure por `insert`, `update`, `delete`, `alter`, `drop`, `create`, `truncate`, `grant` e `call`;
  - o esperado é **0 ocorrências** fora dos comentários;
  - cada consulta é uma única instrução `SELECT`, sem funções com efeitos.
- **Ordem:**
  1. Corra primeiro o **resumo 3.R**: uma instrução, uma tabela de métricas. Cole o resultado na #53.
  2. Só se o resumo divergir do esperado, corra o detalhe 3.D (Q1–Q4), uma consulta de cada vez.
- **Q1 devolve nomes de locais públicos e não tem dados pessoais.** Mesmo assim, para a #53 basta o resumo; não é preciso colar a lista.
- **Validado no staging** (MCP, só SELECT, 25/11): sintaxe e colunas estão correctas. No staging, todas as métricas do alvo dão 0, porque o caso só existe na produção.
- **Valores esperados na produção:**

  | Métrica | Esperado |
  |---|---|
  | Q0 venues | 24 |
  | Q0 activities | 48 |
  | Q2 alvo | ~53 |
  | Q2 skip_removed | ~52 |
  | Q4 | 0 |
  | Q5 (ambas as linhas) | 0 |

- **Se Q4 for maior que 0 ou Q5 for maior que 0:** parar e não decidir o R2. Isso significa que a guarda R1 não cobre o caso como se assumiu.
- **Q3 "já publicadas":** é o número de activities cujo update o R1 passa a suspender (`error`). Cada publicação autorizada ficará `partial` enquanto houver alguma.

### 3.R Resumo (uma única instrução SELECT)
- Usa a **mesma condição da guarda R1**: `event_type='VenuePublished'`, `entity_type='venue'` e `payload->>'engineVenueId'`.
- O Q5 detecta divergências dessa condição.

```sql
with alvo as (                      -- os venues promoted sem vínculo (os "53")
  select vs.id, vs.geographic_status
  from staging.venues_staging vs
  where vs.proposal_status = 'promoted' and vs.promoted_venue_id is null
),
pub as (                            -- mesma condição que a guarda R1 (hasVenuePublishedEvent)
  select distinct e.payload->>'engineVenueId' as engine_venue_id
  from public.publication_events e
  where e.event_type = 'VenuePublished' and e.entity_type = 'venue'
),
pub_sem_entity as (                 -- mesma chave, sem o filtro entity_type (deteção de divergência)
  select distinct e.payload->>'engineVenueId' as engine_venue_id
  from public.publication_events e
  where e.event_type = 'VenuePublished'
),
classif as (
  select a.id,
         (a.geographic_status is distinct from 'outside_region') as elegivel,
         exists (select 1 from pub p where p.engine_venue_id = a.id::text)            as ja_publicado,
         exists (select 1 from pub_sem_entity p where p.engine_venue_id = a.id::text) as ja_publicado_sem_entity
  from alvo a
)
select 'Q0 public.venues (baseline 24)'                         as metrica, count(*)::int as valor from public.venues
union all select 'Q0 public.activities (baseline 48)',               count(*)::int from public.activities
union all select 'Q2 alvo total (promoted sem vínculo; ~53)',         count(*)::int from classif
union all select 'Q2 elegível + já publicado  -> R1: skip_removed',   count(*)::int from classif where elegivel and ja_publicado
union all select 'Q2 elegível + nunca publicado -> R1: insert',       count(*)::int from classif where elegivel and not ja_publicado
union all select 'Q2 outside_region (fora do publish)',               count(*)::int from classif where not elegivel
union all select 'Q4 alvo com venue público vivo (esperado 0)',       count(*)::int
          from public.venues v join alvo a on a.id = v.engine_venue_id
union all select 'Q3 activities staging ligadas ao alvo',             count(*)::int
          from staging.activities_staging s join alvo a on a.id = s.resolved_venue_staging_id
union all select 'Q3 ... dessas, já publicadas (R1: suspensas -> error)', count(*)::int
          from staging.activities_staging s join alvo a on a.id = s.resolved_venue_staging_id
          where s.promoted_activity_id is not null
union all select 'Q5 eventos VenuePublished sem payload.engineVenueId (esperado 0)', count(*)::int
          from public.publication_events e
          where e.event_type = 'VenuePublished' and (e.payload->>'engineVenueId') is null
union all select 'Q5 divergência entity_type (esperado 0)',           count(*)::int
          from classif where ja_publicado <> ja_publicado_sem_entity;
```

### 3.D Detalhe (só se o resumo divergir)

**Q1. Os 53, com o histórico de publicação:**

```sql
select vs.id, vs.name, vs.source_key, vs.city, vs.geographic_status, vs.promoted_at, vs.reviewed_at,
       exists (select 1 from public.publication_events e
               where e.event_type = 'VenuePublished' and e.entity_type = 'venue' and e.payload->>'engineVenueId' = vs.id::text) as ja_publicado,
       exists (select 1 from public.publication_events e
               where e.event_type = 'VenueArchived' and e.payload->>'engineVenueId' = vs.id::text) as ja_arquivado
from staging.venues_staging vs
where vs.proposal_status = 'promoted' and vs.promoted_venue_id is null
order by ja_publicado desc, vs.name;
```

**Q2. Resumo** (o esperado é cerca de 52 `ja_publicado=true`; o resto nunca publicado):

```sql
select (vs.geographic_status is distinct from 'outside_region') as elegivel_publish,
       exists (select 1 from public.publication_events e
               where e.event_type = 'VenuePublished' and e.payload->>'engineVenueId' = vs.id::text) as ja_publicado,
       count(*)
from staging.venues_staging vs
where vs.proposal_status = 'promoted' and vs.promoted_venue_id is null
group by 1, 2 order by 1, 2;
```

**Q3. Actividades de staging que dependem destes locais:**

```sql
select a.proposal_status, (a.promoted_activity_id is not null) as publicada, count(*)
from staging.activities_staging a
where a.resolved_venue_staging_id in (
  select id from staging.venues_staging where proposal_status = 'promoted' and promoted_venue_id is null)
group by 1, 2;
```

**Q4. Garantia:** nenhum dos 53 tem um local público vivo. O esperado é 0.

```sql
select count(*) from public.venues v
join staging.venues_staging vs on vs.id = v.engine_venue_id
where vs.proposal_status = 'promoted' and vs.promoted_venue_id is null;
```

Confirmar também que o `payload` dos eventos usa a chave `engineVenueId`, como em `VenuePublisher.executeDecision`.

## 4. Plano de reconciliação (reversível, por fases; cada fase com autorização própria)

### R0. Congelar (já em vigor; sem alterações)
- Nenhum `publish.ts` contra a produção.
- O `envGuard` mantém-se.
- A Fase 3 da #52 fica dependente de R1 e R2.

### R1. Guarda no código (PR do engine; testes só com fakes; sem dados)
Em `VenuePublisher.buildInsertDecision`, antes de decidir `insert`:
1. **`findByEngineId(stagingId)`** existe → decisão `relink` (só `linkToStaging`, sem insert). Repara um vínculo perdido sem duplicar.
2. **Houve antes um `VenuePublished` para este `stagingId`** e o local público já não existe → nova decisão **`skip_removed_downstream`**: sem insert, só um aviso no preview e nas métricas. Um local removido na produção **nunca é recriado automaticamente**. A republicação exige uma acção humana explícita.
3. **Caso contrário:** `insert`, como hoje.

O mesmo cuidado no lado das actividades: uma actividade cujo local está em `skip_removed_downstream` não é publicada com `venue_id=null`. Fica `error`/`skip` com o motivo.

**Reversível:** reverter o PR. Não toca em dados.

### R2. Marcar o estado nos dados (migração + UPDATE na produção; precisa de backup ≤ 24 h + REF Level 2)
- **Opção recomendada:** uma coluna aditiva `staging.venues_staging.downstream_removed_at timestamptz NULL`, com a regra "`findUnpublished` exclui `downstream_removed_at IS NOT NULL`".
- **UPDATE:** só dos ids confirmados por Q1 (`ja_publicado=true`, sem local vivo, Q4 = 0). Numa transacção:
  1. guardar antes um snapshot `(id, proposal_status, promoted_venue_id, promoted_at)` numa tabela de auditoria;
  2. `RETURNING`;
  3. revalidar a contagem.
- **Rollback:** `UPDATE … SET downstream_removed_at = NULL WHERE id IN (snapshot)`, e a coluna pode ser removida.
- **Não recomendado:** mudar `proposal_status` para `rejected`. Mistura a decisão de revisão com o estado de publicação e não é reversível pela API.
- **Também não:** voltar a escrever `promoted_venue_id` apontando para locais que já não existem. A FK impede-o.

### R3. Itens nunca publicados (se Q2 mostrar alguns)
São promoções legítimas ainda por publicar. Ficam como estão: o R1 deixa-os seguir para `insert` normal numa publicação **autorizada**, com preview e revisão humana (Fase 3 da #52).

### R4. Verificação pós-reconciliação (só leitura)
- `publish.ts --preview` **no staging** com fixtures que imitem o caso: 0 inserts para os removidos.
- Na produção, só depois de autorização: contagens de `public.venues` sem alteração (24) e Q4 = 0.

## 5. O que fica para o PO
1. Correr **Q1–Q4** (só SELECT) e colar os resultados agregados na #53. Não é preciso colar os nomes, se não quiser.
2. Autorizar **R1** (PR de código, sem dados).
3. Decidir sobre **R2** (migração + UPDATE na produção), com backup ≤ 24 h e REF Level 2.
