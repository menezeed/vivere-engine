# Contrato: elegibilidade 60+ no Engine Admin (Issue #62)

**Versão:** 1, de 26/11/2026. **Âmbito:** só leitura, para o produto `vivere-60-plus-uk-test` em staging.

Este contrato **não** cria colunas, tabelas, migrações nem permissões. A classificação **não é aprovação nem publicação**, e nenhuma resposta muda o `proposal_status`.

## 1. Fonte dos dados

| | |
|---|---|
| Ficheiro | `src/review-api/eligibility/richmond-u3a-60plus.v1.json` (versionado no git) |
| Origem | Auditoria do PR #61 (`docs/operacao/AUDITORIA-60PLUS-RICHMOND.md`), convertida sem reclassificar |
| Chave de associação | `(source_key, source_item_id)` de `staging.raw_activity_items`, por exemplo `u3a_richmond` + `group:270` |
| Verificação cruzada | `source_url` do ficheiro tem de ser igual a `raw_activity_items.external_url` |
| Título | **Nunca** é usado para associar |

**Verificação feita a 26/11/2026** (staging, só leitura):
- as 133 actividades têm `source_item_id` único e URL única;
- o hash MD5 dos pares `source_item_id|external_url` ordenados é `e40f2811f1bd5d32eb69aecc9c353d0d`, igual nos dados e no staging.

**Coerência com o relatório:** um teste compara as 133 linhas do relatório com o ficheiro (título, classe, evidência e recomendação). Se o relatório mudar sem o ficheiro, ou o ficheiro sem o relatório, o CI falha.

## 2. Endpoints (Review API)

A autenticação é a mesma de todo o `/api/*`:

| Pedido | Resposta |
|---|---|
| Sem token | `401` |
| Token sem papel | `403` |
| `viewer`, `reviewer` ou `admin` | Leitura permitida |

Não há rotas novas. Os blocos são acrescentados às rotas existentes.

### 2.1 `GET /api/activities`

**Parâmetro novo:** `eligibility`, uma lista separada por vírgulas de:

| Valor | Significado |
|---|---|
| `confirmed_60plus` | 60+ confirmado |
| `likely_suitable` | Provavelmente adequada |
| `unclear` | Não confirmado |
| `unsuitable` | Inadequada |
| `not_audited` | Actividade do produto sem registo na auditoria |

Regras do filtro:
- **Aplicação no servidor:** o filtro é aplicado antes da paginação. `totalItems` e `totalPages` já o reflectem, e combina com `status`, `search`, `sort` e `page`.
- **Valor inválido:** dá `400 {"error":"Parâmetro eligibility inválido"}`.
- **Produto sem auditoria** (ex.: `vivere-60-mais`) ou **flag desligada:** dá `400`.

**Cada item da resposta ganha `eligibility`:**

```ts
eligibility: null | {
  status: 'matched' | 'not_audited' | 'mismatch';
  classification: 'confirmed_60plus' | 'likely_suitable' | 'unclear' | 'unsuitable' | null;
  confidence: 'high' | 'medium_high' | 'medium' | 'low' | null;
  availability: 'open' | 'waiting_list' | 'closed' | 'unknown' | null;
  approval_allowed: boolean;   // o servidor aceita approve/promote?
}
```

- O valor é `null` para produtos sem auditoria (o BR não muda).
- O campo não existe quando a flag está desligada (`off`).
- Cada item passa também a trazer `source_item_id`.

### 2.2 `GET /api/activities/:id`

`data.eligibility` traz o mesmo resumo, mais:

```ts
{
  record: EligibilityRecord | null;      // null se status != 'matched'
  membership: MembershipInfo | null;     // só se record.membership_required === true
  audit: { report: string; verified_at: string; schema_version: 1 };
  notice: 'Classificação de elegibilidade não é aprovação nem publicação. O estado de revisão não muda.';
}

interface EligibilityRecord {
  source_item_id: string;                // "group:270"
  source_url: string;                    // página oficial da actividade
  title: string;
  kind: 'group' | 'event';
  classification: 'confirmed_60plus' | 'likely_suitable' | 'unclear' | 'unsuitable';
  confidence: 'high' | 'medium_high' | 'medium' | 'low';
  evidence: string;                      // paráfrase, sem dados pessoais
  eligibility_type: 'exclusive_60plus' | 'open_to_60plus' | 'unknown' | 'not_applicable';
  membership_required: true | null;      // null = NÃO CONFIRMADO
  availability: 'open' | 'waiting_list' | 'closed' | 'unknown';
  additional_costs: string | null;       // null = NÃO CONFIRMADO (nunca "gratuito")
  physical_activity: boolean;
  distances_cited: string[];
  levels_cited: string[];
  access_notes: string | null;           // null = não confirmado
  schedule_complete_in_source: boolean;
  generic_venue: boolean;                // pub/hotel/café: não indica público 60+
  recommendation: string;
}

interface MembershipInfo {
  organisation: 'Richmond upon Thames u3a';
  source_url: 'https://u3abeacon.org.uk/u3ajoin.php?sc=VMQG&u3a=466';
  verified_at: '2026-11-26';
  valid_until: '2027-09-01';
  currency: 'GBP';
  fees: Array<{ category: string; label: string; amount: number; per_person: boolean; description: string }>;
  note: string; // quota ≠ preço da actividade; confirmar na fonte antes de mostrar como valor actual
}
```

**Horário e local** não fazem parte do bloco: já vêm nos campos actuais da actividade.

| Dado | Campos |
|---|---|
| Horário | `occurrences` e `raw_payload.when_text` |
| Local | `venue_mention_raw_text` e `raw_payload.venue_text` |
| Fonte | `source_key` e `external_url` |

### 2.3 `PATCH /api/activities/:id/approve|promote`

Há uma guarda no servidor, além da UI:
- **Produtos auditados:** `approve` e `promote` só passam quando `status = 'matched'` e `classification = 'confirmed_60plus'`.
- **Restantes casos** (`likely_suitable`, `unclear`, `unsuitable`, `not_audited` e `mismatch`): dão `403 {"error":"'approve' bloqueado: a elegibilidade 60+ desta actividade não está confirmada"}` e nada é escrito.
- **`reject`:** segue só o RBAC normal.
- **Produtos sem auditoria** (BR): não são afectados.
- **Independência da flag:** a guarda não depende da flag e continua activa com `off`.

## 3. Regras para a UI

| `classification` | Badge |
|---|---|
| `confirmed_60plus` | **60+ confirmado** |
| `likely_suitable` | **Provavelmente adequada** |
| `unclear` | **Não confirmado** |
| `unsuitable` | **Inadequada** |
| `status = not_audited` | **Sem auditoria** (tratar como não confirmado) |
| `status = mismatch` | **Dados não correspondem**: não mostrar classificação nem evidência |

| `eligibility_type` | Texto |
|---|---|
| `exclusive_60plus` | Exclusivo 60+ (nenhum caso hoje) |
| `open_to_60plus` | Aberto a 60+ (sem limite de idade) |
| `unknown` | Não confirmado |
| `not_applicable` | Não é uma actividade |

| `availability` | Texto |
|---|---|
| `open` | Aberto a novos membros |
| `waiting_list` | Cheio, lista de espera |
| `closed` | Fechado a novos membros |
| `unknown` | Não confirmado |

Obrigatório:
1. **Valores `null` aparecem como "Não confirmado".** `additional_costs = null` **nunca** é "Gratuito".
2. **A quota (`membership.fees`) aparece separada dos custos da actividade,** com o texto de `note`, a data `verified_at` e o link `source_url`.
3. **`notice` aparece sempre** no detalhe e no cabeçalho da lista de um produto auditado.
4. **`approval_allowed = false` esconde ou desactiva Aprovar e Promover.** É uma conveniência visual; a autoridade é o 403 do servidor.
5. **O filtro usa `?eligibility=`.** Não se filtra a página já carregada.

## 4. Exemplo (Seated Exercise)

```json
{
  "status": "matched",
  "classification": "confirmed_60plus",
  "confidence": "high",
  "availability": "waiting_list",
  "approval_allowed": true,
  "record": {
    "source_item_id": "group:270",
    "source_url": "https://rut.u3asite.uk/u3a_groups/extend-exercise/",
    "title": "Seated Exercise",
    "kind": "group",
    "classification": "confirmed_60plus",
    "confidence": "high",
    "evidence": "A página diz que o professor é qualificado para exercício de pessoas com mais de 60 anos e pessoas com deficiência.",
    "eligibility_type": "open_to_60plus",
    "membership_required": true,
    "availability": "waiting_list",
    "additional_costs": null,
    "physical_activity": false,
    "distances_cited": [],
    "levels_cited": [],
    "access_notes": "Exercício sentado; a página refere aptidão para pessoas com deficiência.",
    "schedule_complete_in_source": true,
    "generic_venue": false,
    "recommendation": "Manter em pending_review; primeira candidata à revisão humana. Indicar a lista de espera."
  },
  "membership": { "organisation": "Richmond upon Thames u3a", "valid_until": "2027-09-01", "currency": "GBP", "fees": ["…4 categorias…"] },
  "audit": { "report": "docs/operacao/AUDITORIA-60PLUS-RICHMOND.md", "verified_at": "2026-11-26", "schema_version": 1 },
  "notice": "Classificação de elegibilidade não é aprovação nem publicação. O estado de revisão não muda."
}
```

## 5. Feature flag e rollback

| `REVIEW_API_ELIGIBILITY_AUDIT` | Efeito |
|---|---|
| ausente ou `on` | Blocos `eligibility` e filtro activos |
| `off` | Sem blocos nem filtro (o filtro dá `400`); **a guarda de approve/promote mantém-se** |

**Rollback:**
1. Arrancar a Review API com `REVIEW_API_ELIGIBILITY_AUDIT=off`.
2. Se for preciso retirar também a guarda, reverter o PR.

Não há dados a reverter.

**Arranque:** o ficheiro é validado no arranque (formato, enums, ids e URLs únicos). Se for inválido, a Review API não arranca.

## 6. Alterar os dados

- **Nova versão:** um ficheiro novo `…v2.json` (com `schema_version` novo, se o formato mudar). Os dados vêm de uma auditoria revista e documentada, e o relatório Markdown é actualizado em conjunto, porque o teste de coerência compara os dois.
- **Re-ingestão:** se reingerir a fonte mudar `source_item_id` ou `external_url`, a actividade passa a `not_audited` ou `mismatch` e fica bloqueada para aprovação até a auditoria ser actualizada.

## 7. Limitações conhecidas

- `physical_activity` reproduz o relatório, que marcou actividade física pelo título ou pela categoria. Por isso "Seated Exercise" (categoria Social) fica `false`. Para corrigir, é preciso uma revisão da auditoria; isso não se muda só nos dados.
- A quota foi verificada a 26/11/2026. Antes de a mostrar como valor actual, confirmar `source_url`.
