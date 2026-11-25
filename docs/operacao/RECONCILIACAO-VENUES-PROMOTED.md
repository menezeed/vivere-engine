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
union all select 'Q2 elegível + nunca publicado -> R1: cria',       count(*)::int from classif where elegivel and not ja_publicado
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

> **Estado: PLANO, NÃO EXECUTADO.** Nada aqui foi aplicado em nenhum ambiente. Cada passo precisa de uma autorização própria do PO.

#### R2.0 Evidência de partida (bloco 1 corrido pelo PO na produção, 25/11: PASS)

| Métrica | Valor | Leitura |
|---|---|---|
| Q0 public.venues / public.activities | 24 / 48 | baseline intacta |
| Q2 alvo (promoted sem vínculo) | 53 | — |
| Q2 elegível + já publicado | **52** | o R1 dá `skip_removed_downstream` |
| Q2 elegível + nunca publicado | **0** | ninguém seria criado (R3 vazio) |
| Q2 outside_region | 1 | já excluído do publish pela ADR-0022 |
| Q4 alvo com venue público vivo | **0** | não há relink a fazer |
| Q3 activities de staging ligadas ao alvo | 16 | — |
| Q3 dessas, já publicadas | **0** | o R1 não gera runs `partial` |
| Q5 (payload / entity_type) | 0 / 0 | a condição da guarda R1 cobre os 52 |

**Conclusão:** com o R1 em vigor, o risco de recriação fica **neutralizado** para os 52. O R2 **não é urgente**: torna o estado explícito e durável, mas não corrige nada que o R1 deixe aberto hoje.

#### R2.1 Objectivo
- Marcar nos dados, de forma explícita e auditável, que estes 52 venues foram **removidos a jusante por decisão do PO**.
- Fazer o `findUnpublished` deixar de os devolver.
- **O que isso traz em relação ao R1 sozinho:**
  1. **Independência do histórico.** O R1 depende de `publication_events`. Se essa tabela for limpa ou truncada, a guarda deixa de reconhecer os 52 e estes voltam a ser candidatos a insert. O R2 não depende do histórico.
  2. **Visibilidade.** O Admin (#52) e a Review API passam a poder mostrar "removido da produção", em vez de "promoted sem publicação".
  3. **Custo.** Deixam de ser feitas ~104 leituras por run.
  4. **Decisão reversível e humana.** Repor um venue passa a ser limpar a marca, numa acção explícita.

#### R2.2 Âmbito exacto
- **Marcados:** só os ids que cumprem **todas** as condições, recalculadas dentro da transacção e não copiadas de uma lista:
  - `proposal_status='promoted'`;
  - `promoted_venue_id IS NULL`;
  - elegível (não `outside_region`);
  - com `VenuePublished` (`entity_type='venue'`);
  - sem `public.venues` vivo.
  - Esperado: **exactamente 52**. Outro número aborta a transacção.
- **Não marcados:**
  - o venue `outside_region`, que já está fora do publish;
  - as 16 activities de staging, que ficam como estão. Nenhuma está publicada e um insert delas já dá `skip_no_location` (G2). O destino delas é uma decisão de curadoria separada (Admin/#52).
- **Não tocados:** todo o `public.*` (app, catálogo, RLS), `proposal_status`, `promoted_venue_id` e `publication_events`.

#### R2.3 Passos e ordem (cada um com autorização própria)

| # | Passo | Ambiente | Precisa de |
|---|---|---|---|
| a | PR de migração `00NN_venues_staging_downstream_removed` (+ `.rollback.sql`) e PR de código | — | só revisão; o número é confirmado contra o manifesto à data |
| b | Aplicar a migração e testes direccionados | **staging** | autorização do PO |
| c | Merge do R1 (PR #57) e do código R2 | — | autorização de merge |
| d | Backup da produção ≤ 24 h, verificado | produção | PO |
| e | Aplicar a migração e o UPDATE numa janela | **produção** | **REF Level 2 + autorização explícita** |
| f | Verificação só de leitura (bloco 1 + R2.6) | produção | PO corre |

**Ordem obrigatória:** primeiro a coluna (b/e), depois o código que a lê (c).
- Se o código chegar antes da coluna, o `findUnpublished` falha e a publicação dá erro.
- Esse modo é fechado: não cria nada, mas parte a publicação.

**Conteúdo previsto da migração:**
- **Pré-condições que abortam:**
  - correr como `postgres`;
  - a coluna ainda não existe;
  - o marcador está ausente.
- **Alterações:**
  - `ALTER TABLE staging.venues_staging ADD COLUMN downstream_removed_at timestamptz NULL` e `downstream_removed_reason text NULL`. São aditivas, sem default e sem rewrite da tabela;
  - uma tabela de snapshot `staging.venues_downstream_removed_snapshot (venue_staging_id, proposal_status, promoted_venue_id, geographic_status, promoted_at, snapshot_at, ref)`, com RLS ligado e sem grants a anon nem a authenticated;
  - um comentário-marcador na coluna, à maneira da 0031.

**Conteúdo previsto do UPDATE na produção**, uma transacção (`begin … commit`):
1. Um lock em `staging.venues_staging` em modo `share row exclusive`.
2. Recalcular o conjunto com as condições de R2.2 e **abortar se a contagem for diferente de 52**, ou se Q4 for maior que 0.
3. Gravar no snapshot o estado anterior desses ids.
4. `UPDATE … SET downstream_removed_at = now(), downstream_removed_reason = 'limpeza produção 25/11 (#53)' WHERE id IN (conjunto) RETURNING id`.
5. Verificação final: 52 marcados, 52 no snapshot, `public.venues` = 24 e `public.activities` = 48. Qualquer diferença lança uma excepção e a transacção é desfeita.

**Código** (PR próprio, depois do PR #57):
- `findUnpublished` ganha `.is('downstream_removed_at', null)`;
- o R1 fica como segunda linha de defesa;
- testes com fakes e um teste de contrato.

#### R2.4 Impacto
- **App, utilizadores e catálogo público:** nenhum. O `public.*` não é alterado, por isso as 24 venues e as 48 activities ficam iguais.
- **Base de produção:**
  - 2 colunas nullable numa tabela de staging, com escrita só em metadados;
  - 1 tabela de snapshot com 52 linhas;
  - 52 UPDATEs.
  - O volume é desprezável no plano FREE.
- **Publishing Engine:** 52 venues a menos na lista de candidatos. O preview deixa de os mostrar como `skip_removed_downstream`, porque já nem são lidos.
- **Review API / Admin:**
  - as consultas com colunas explícitas não mudam;
  - mostrar o estado novo é trabalho opcional, já na Fase 2 da #52.
- **Custos novos:** nenhum.

#### R2.5 Riscos e mitigação

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Marcar ids errados (conjunto diferente de 52) | baixa | médio | conjunto recalculado dentro da transacção; aborta se ≠ 52 ou Q4 > 0; snapshot prévio |
| Código deployado antes da coluna | média | médio (publicação partida, nada criado) | ordem obrigatória de R2.3; a falha é fechada |
| Aplicação manual (sem runner) e erro de operador | média | médio | um script único com pré e pós-condições que abortam; ensaiado antes no staging; REF L2 |
| Deriva staging ↔ produção (a migração só num lado) | média | baixo | aplicar nos dois; `APPLIED.sha256`; registar no manifesto |
| Mais tarde, querer republicar um dos 52 | baixa | baixo | limpar a marca do id (acção humana registada); o R1 continua a exigir decisão explícita |
| Backup indisponível ou inválido | baixa | alto | o passo e só avança com um backup ≤ 24 h verificado |
| Exposição da coluna nova | baixa | baixo | o schema `staging` não é exposto a anon; o snapshot fica sem grants |

#### R2.6 Rollback (minutos; em duas camadas)
1. **Dados.** `UPDATE staging.venues_staging SET downstream_removed_at = NULL, downstream_removed_reason = NULL WHERE id IN (SELECT venue_staging_id FROM staging.venues_downstream_removed_snapshot WHERE ref = '#53-R2')`. O snapshot fica para auditoria. O estado volta ao de hoje: os 52 ficam de novo protegidos só pelo R1.
2. **Código.** Reverter o PR do R2. Tem de ser feito **antes** do passo 3.
3. **Schema.** `00NN_….rollback.sql`:
   - pré-condição: nenhuma linha marcada, ou exportação prévia do snapshot;
   - `DROP COLUMN` das 2 colunas e `DROP TABLE` do snapshot.

**Verificação pós-R2** (só SELECT): o bloco 1 dá os mesmos valores Q0/Q4/Q5, e mais:
- `count(*) where downstream_removed_at is not null` = 52;
- snapshot = 52;
- o `findUnpublished` no preview devolve 0 dos 52.

#### R2.7 Alternativas consideradas
- **Não fazer o R2 e ficar só com o R1:** é aceitável a curto prazo, dados os resultados acima. O risco residual é a retenção de `publication_events`. Recomenda-se, nesse caso, documentar que essa tabela é append-only e não pode ser limpa.
- **Não recomendado:** mudar `proposal_status` para `rejected`. Mistura a decisão de revisão com o estado de publicação e não é reversível pela API.
- **Também não:** voltar a escrever `promoted_venue_id` apontando para locais que já não existem. A FK impede-o.

### R3. Itens nunca publicados (se Q2 mostrar alguns)
São promoções legítimas ainda por publicar. Ficam como estão: o R1 deixa-os seguir para `insert` normal numa publicação **autorizada**, com preview e revisão humana (Fase 3 da #52).

### R4. Verificação pós-reconciliação (só leitura)
- `publish.ts --preview` **no staging** com fixtures que imitem o caso: 0 inserts para os removidos.
- Na produção, só depois de autorização: contagens de `public.venues` sem alteração (24) e Q4 = 0.

## 5. O que fica para o PO
1. ~~Correr Q1–Q4~~ **Feito a 25/11: PASS** (R2.0).
2. Rever e autorizar o merge do **R1** (PR #57).
3. Decidir sobre o **R2** (R2.3). As opções:
   - autorizar só o passo a+b (PR de migração e ensaio no staging);
   - ou adiar o R2 e ficar com o R1 mais a regra de retenção de `publication_events` (R2.7).
