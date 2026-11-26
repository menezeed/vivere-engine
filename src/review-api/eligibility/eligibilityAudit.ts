/**
 * Elegibilidade 60+ auditada (Issue #62). Só leitura.
 *
 * Fonte: richmond-u3a-60plus.v1.json, gerado a partir da auditoria do PR #61
 * (docs/operacao/AUDITORIA-60PLUS-RICHMOND.md). Não é estado da base de
 * dados: nada aqui escreve no staging nem altera proposal_status.
 *
 * Associação por chave estável (source_key, source_item_id), nunca por
 * título. A URL canónica (source_url == raw_activity_items.external_url)
 * é verificada em cada associação. Se divergir, a actividade fica "mismatch"
 * e nenhum dado da auditoria é exposto (falha fechada).
 *
 * Contrato para o frontend: docs/operacao/CONTRATO-ELEGIBILIDADE-60PLUS.md
 */
import { readFileSync } from 'node:fs';

export const ELIGIBILITY_CLASSES = ['confirmed_60plus', 'likely_suitable', 'unclear', 'unsuitable'] as const;
export type EligibilityClass = typeof ELIGIBILITY_CLASSES[number];
/** Filtro extra: actividades de um produto auditado sem registo na auditoria. */
export const NOT_AUDITED = 'not_audited' as const;
export type EligibilityFilter = EligibilityClass | typeof NOT_AUDITED;

const CONFIDENCES = ['high', 'medium_high', 'medium', 'low'] as const;
const ELIGIBILITY_TYPES = ['exclusive_60plus', 'open_to_60plus', 'unknown', 'not_applicable'] as const;
const AVAILABILITIES = ['open', 'waiting_list', 'closed', 'unknown'] as const;
const KINDS = ['group', 'event'] as const;

export interface EligibilityRecord {
  source_item_id: string;
  source_url: string;
  title: string;
  kind: typeof KINDS[number];
  classification: EligibilityClass;
  confidence: typeof CONFIDENCES[number];
  evidence: string;
  eligibility_type: typeof ELIGIBILITY_TYPES[number];
  /** true = a fonte diz "só membros"; null = não confirmado. */
  membership_required: true | null;
  availability: typeof AVAILABILITIES[number];
  /** Custo adicional citado na página; null = NÃO CONFIRMADO (nunca "gratuito"). */
  additional_costs: string | null;
  physical_activity: boolean;
  distances_cited: string[];
  levels_cited: string[];
  access_notes: string | null;
  schedule_complete_in_source: boolean;
  generic_venue: boolean;
  recommendation: string;
}

export interface MembershipFee {
  category: string;
  label: string;
  amount: number;
  per_person: boolean;
  description: string;
}

export interface MembershipInfo {
  organisation: string;
  source_url: string;
  verified_at: string;
  valid_until: string;
  currency: string;
  fees: MembershipFee[];
  note: string;
}

export interface EligibilityDataset {
  schema_version: 1;
  product_key: string;
  source_key: string;
  audit_report: string;
  verified_at: string;
  membership: MembershipInfo;
  items: EligibilityRecord[];
}

/** Bloco compacto devolvido em cada linha de GET /api/activities. */
export interface EligibilitySummary {
  status: 'matched' | 'not_audited' | 'mismatch';
  classification: EligibilityClass | null;
  confidence: EligibilityRecord['confidence'] | null;
  availability: EligibilityRecord['availability'] | null;
  /** Se o servidor aceita approve/promote. Classificação ≠ aprovação. */
  approval_allowed: boolean;
}

/** Bloco completo devolvido em GET /api/activities/:id. */
export interface EligibilityDetail extends EligibilitySummary {
  record: EligibilityRecord | null;
  membership: MembershipInfo | null;
  audit: { report: string; verified_at: string; schema_version: number };
  notice: string;
}

export const CLASSIFICATION_NOTICE =
  'Classificação de elegibilidade não é aprovação nem publicação. O estado de revisão não muda.';

/** Só esta classe permite approve/promote numa actividade de produto auditado. */
const APPROVABLE: ReadonlySet<EligibilityClass> = new Set(['confirmed_60plus']);

export interface ActivityKey {
  product_key: string;
  source_key?: string | null;
  source_item_id?: string | null;
  external_url?: string | null;
}

export type LookupResult =
  | { status: 'not_covered' }
  | { status: 'not_audited' }
  | { status: 'mismatch'; reason: string }
  | { status: 'matched'; record: EligibilityRecord; dataset: EligibilityDataset };

// ── Validação (falha no arranque/teste, não em runtime) ─────────────────────

function oneOf<T extends string>(v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new Error(`${where}: valor inválido ${JSON.stringify(v)}`);
  }
  return v as T;
}
function str(v: unknown, where: string, { nullable = false } = {}): string | null {
  if (v === null && nullable) return null;
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${where}: texto obrigatório`);
  return v;
}
function bool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${where}: booleano obrigatório`);
  return v;
}
function strArray(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new Error(`${where}: lista de textos obrigatória`);
  return v as string[];
}

export function parseEligibilityDataset(raw: unknown): EligibilityDataset {
  const d = raw as Record<string, unknown>;
  if (!d || d['schema_version'] !== 1) throw new Error('elegibilidade: schema_version tem de ser 1');
  // No ficheiro: "product" e "source" (mapeados para product_key/source_key).
  const product_key = str(d['product'], 'product')!;
  const source_key = str(d['source'], 'source')!;
  const m = d['membership'] as Record<string, unknown>;
  if (!m || !Array.isArray(m['fees']) || m['fees'].length === 0) throw new Error('membership.fees obrigatório');
  const fees = (m['fees'] as Record<string, unknown>[]).map((f, i) => {
    if (typeof f['amount'] !== 'number' || !(f['amount'] > 0)) throw new Error(`membership.fees[${i}].amount inválido`);
    return {
      category: str(f['category'], `fees[${i}].category`)!, label: str(f['label'], `fees[${i}].label`)!,
      amount: f['amount'], per_person: bool(f['per_person'], `fees[${i}].per_person`),
      description: str(f['description'], `fees[${i}].description`)!,
    };
  });
  if (!Array.isArray(d['items'])) throw new Error('items obrigatório');
  const seen = new Set<string>();
  const urls = new Set<string>();
  const items = (d['items'] as Record<string, unknown>[]).map((it, i) => {
    const w = `items[${i}]`;
    const source_item_id = str(it['source_item_id'], `${w}.source_item_id`)!;
    if (!/^(group|event):\d+$/.test(source_item_id)) throw new Error(`${w}.source_item_id com formato inválido`);
    if (seen.has(source_item_id)) throw new Error(`${w}: source_item_id duplicado ${source_item_id}`);
    seen.add(source_item_id);
    const source_url = str(it['source_url'], `${w}.source_url`)!;
    if (!source_url.startsWith('https://')) throw new Error(`${w}.source_url tem de ser https`);
    if (urls.has(source_url)) throw new Error(`${w}: source_url duplicada`);
    urls.add(source_url);
    const mr = it['membership_required'];
    if (mr !== true && mr !== null) throw new Error(`${w}.membership_required tem de ser true ou null`);
    return {
      source_item_id, source_url,
      title: str(it['title'], `${w}.title`)!,
      kind: oneOf(it['kind'], KINDS, `${w}.kind`),
      classification: oneOf(it['classification'], ELIGIBILITY_CLASSES, `${w}.classification`),
      confidence: oneOf(it['confidence'], CONFIDENCES, `${w}.confidence`),
      evidence: str(it['evidence'], `${w}.evidence`)!,
      eligibility_type: oneOf(it['eligibility_type'], ELIGIBILITY_TYPES, `${w}.eligibility_type`),
      membership_required: mr,
      availability: oneOf(it['availability'], AVAILABILITIES, `${w}.availability`),
      additional_costs: str(it['additional_costs'], `${w}.additional_costs`, { nullable: true }),
      physical_activity: bool(it['physical_activity'], `${w}.physical_activity`),
      distances_cited: strArray(it['distances_cited'], `${w}.distances_cited`),
      levels_cited: strArray(it['levels_cited'], `${w}.levels_cited`),
      access_notes: str(it['access_notes'], `${w}.access_notes`, { nullable: true }),
      schedule_complete_in_source: bool(it['schedule_complete_in_source'], `${w}.schedule_complete_in_source`),
      generic_venue: bool(it['generic_venue'], `${w}.generic_venue`),
      recommendation: str(it['recommendation'], `${w}.recommendation`)!,
    } satisfies EligibilityRecord;
  });
  return {
    schema_version: 1, product_key, source_key,
    audit_report: str(d['audit_report'], 'audit_report')!,
    verified_at: str(d['verified_at'], 'verified_at')!,
    membership: {
      organisation: str(m['organisation'], 'membership.organisation')!,
      source_url: str(m['source_url'], 'membership.source_url')!,
      verified_at: str(m['verified_at'], 'membership.verified_at')!,
      valid_until: str(m['valid_until'], 'membership.valid_until')!,
      currency: str(m['currency'], 'membership.currency')!,
      fees, note: str(m['note'], 'membership.note')!,
    },
    items,
  };
}

// ── Índice ───────────────────────────────────────────────────────────────────

export class EligibilityAuditIndex {
  private readonly byProduct = new Map<string, { dataset: EligibilityDataset; byId: Map<string, EligibilityRecord> }>();

  constructor(datasets: EligibilityDataset[]) {
    for (const ds of datasets) {
      if (this.byProduct.has(ds.product_key)) throw new Error(`elegibilidade: produto repetido ${ds.product_key}`);
      this.byProduct.set(ds.product_key, { dataset: ds, byId: new Map(ds.items.map(i => [i.source_item_id, i])) });
    }
  }

  covers(productKey: string | undefined | null): boolean {
    return !!productKey && this.byProduct.has(productKey);
  }

  lookup(key: ActivityKey): LookupResult {
    const entry = this.byProduct.get(key.product_key);
    if (!entry) return { status: 'not_covered' };
    const { dataset, byId } = entry;
    if (!key.source_item_id || key.source_key !== dataset.source_key) return { status: 'not_audited' };
    const record = byId.get(key.source_item_id);
    if (!record) return { status: 'not_audited' };
    if (!key.external_url || key.external_url !== record.source_url) {
      return { status: 'mismatch', reason: 'source_url diferente de external_url' };
    }
    return { status: 'matched', record, dataset };
  }

  /** Guarda do servidor: produtos não auditados não são afectados. */
  approvalAllowed(key: ActivityKey): boolean {
    const r = this.lookup(key);
    if (r.status === 'not_covered') return true;
    return r.status === 'matched' && APPROVABLE.has(r.record.classification);
  }

  summary(key: ActivityKey): EligibilitySummary | null {
    const r = this.lookup(key);
    if (r.status === 'not_covered') return null;
    const rec = r.status === 'matched' ? r.record : null;
    return {
      status: r.status,
      classification: rec?.classification ?? null,
      confidence: rec?.confidence ?? null,
      availability: rec?.availability ?? null,
      approval_allowed: this.approvalAllowed(key),
    };
  }

  detail(key: ActivityKey): EligibilityDetail | null {
    const r = this.lookup(key);
    if (r.status === 'not_covered') return null;
    const ds = this.byProduct.get(key.product_key)!.dataset;
    const rec = r.status === 'matched' ? r.record : null;
    return {
      ...this.summary(key)!,
      record: rec,
      membership: rec?.membership_required ? ds.membership : null,
      audit: { report: ds.audit_report, verified_at: ds.verified_at, schema_version: ds.schema_version },
      notice: CLASSIFICATION_NOTICE,
    };
  }

  /**
   * Filtro por classificação, para aplicar NO SERVIDOR (antes do range),
   * mantendo a paginação correcta. null = produto não coberto (sem filtro possível).
   */
  filterIds(productKey: string, filters: EligibilityFilter[]): { mode: 'in' | 'not_in'; ids: string[] } | null {
    const entry = this.byProduct.get(productKey);
    if (!entry) return null;
    const classes = new Set(filters.filter((f): f is EligibilityClass => f !== NOT_AUDITED));
    const wanted = entry.dataset.items.filter(i => classes.has(i.classification)).map(i => i.source_item_id);
    if (!filters.includes(NOT_AUDITED)) return { mode: 'in', ids: wanted };
    // not_audited (+ classes): tudo menos as classes NÃO pedidas.
    const excluded = entry.dataset.items.filter(i => !classes.has(i.classification)).map(i => i.source_item_id);
    return { mode: 'not_in', ids: excluded };
  }
}

export function parseEligibilityFilter(raw: string | undefined): EligibilityFilter[] | null | 'invalid' {
  if (raw === undefined || raw === '') return null;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const allowed: readonly string[] = [...ELIGIBILITY_CLASSES, NOT_AUDITED];
  if (parts.length === 0 || parts.some(p => !allowed.includes(p))) return 'invalid';
  return [...new Set(parts)] as EligibilityFilter[];
}

// ── Carregamento e feature flag ──────────────────────────────────────────────

export const DATASET_FILES = ['richmond-u3a-60plus.v1.json'] as const;

export function loadEligibilityIndex(files: readonly string[] = DATASET_FILES): EligibilityAuditIndex {
  return new EligibilityAuditIndex(files.map(f =>
    parseEligibilityDataset(JSON.parse(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'))),
  ));
}

/**
 * Flag REVIEW_API_ELIGIBILITY_AUDIT: 'off' esconde os blocos de elegibilidade
 * e o filtro (rollback). Por omissão está ligada. A guarda de approve/promote
 * NÃO depende da flag: continua activa com a flag desligada.
 */
export function isEligibilityExposed(env: Record<string, string | undefined>): boolean {
  return (env['REVIEW_API_ELIGIBILITY_AUDIT'] ?? 'on').toLowerCase() !== 'off';
}
