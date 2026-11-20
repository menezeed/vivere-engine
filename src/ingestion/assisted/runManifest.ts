/**
 * E4 — registo auditável de cada execução assistida (manifesto JSON).
 *
 * Escrito em runs/manifests/<run_id>.json (directório local, ignorado
 * pelo git). Contém SÓ: identificadores, datas UTC, commit, região,
 * fontes e estado por fonte, contagens, relatórios L4/E7 (agregados) e
 * o RÓTULO do ambiente alvo ('staging'). NUNCA contém valores de
 * variáveis de ambiente, chaves, URLs completos ou corpos de resposta.
 *
 * Defesa em profundidade: serializeRunManifest() passa TODAS as strings
 * por sanitizeText() (URLs reduzidos ao host, padrões de segredo
 * mascarados, texto truncado) e, no fim, falha FECHADO se algum padrão
 * proibido sobreviver (FORBIDDEN_MANIFEST_PATTERNS).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunQualityReport } from '../../pipeline/metrics/runQualityMetrics';
import type { SourceHealthReport } from '../../pipeline/health/sourceHealth';
import type { IngestionErrorClass } from './transientErrors';

export const RUN_MANIFEST_SCHEMA_VERSION = 1;

export type ManifestSourceStatus = 'ok' | 'failed' | 'skipped';
export type ManifestOutcome = 'ok' | 'failed' | 'critical' | 'refused' | 'error';

export interface ManifestSourceEntry {
  source_key: string;
  status: ManifestSourceStatus;
  /** Só para failed. */
  error_class: IngestionErrorClass | null;
  /** Estado HTTP do erro, se houver. Nunca a mensagem nem o corpo da resposta. */
  http_status: number | null;
  /** Host do pedido que falhou, se conhecido (nunca caminho nem query). */
  error_host: string | null;
  /** Só para skipped. */
  skip_reason: string | null;
  /** Tentativas repetidas por erro transitório (retry). */
  retries: number;
  counts: { collected: number; persisted: number; staged: number; discarded: number } | null;
  /** counts.discarded agregado pela classe do motivo (ex.: narrative_ambiguous). Sem conteúdo dos posts. */
  discarded_by_reason?: Record<string, number> | null;
  ingestion_run_id: string | null;
}

export interface PreflightCheckRecord {
  id: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail: string;
}

export interface RunManifest {
  schema_version: number;
  run_id: string;
  started_at: string;
  finished_at: string;
  git: { commit: string | null; dirty: boolean | null };
  region: string;
  dry_run: boolean;
  /** Rótulo do ambiente alvo, tal como o envGuard o expõe ('staging'); null em dry-run. Nunca a chave nem o URL. */
  target_environment: 'staging' | null;
  since_days: number | null;
  sources_attempted: string[];
  sources: ManifestSourceEntry[];
  totals: { sources_ok: number; sources_failed: number; sources_skipped: number; collected: number; persisted: number; staged: number };
  quality: RunQualityReport | null;
  health: SourceHealthReport | null;
  preflight: PreflightCheckRecord[];
  outcome: ManifestOutcome;
  exit_code: number;
  /** Motivo de recusa/erro (sanitizado). */
  reason: string | null;
}

const MAX_TEXT = 300;

/** Nomes de parâmetros com aspecto de credencial (alternância regex). */
const CREDENTIAL_NAMES =
  'x-api-key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd|authorization|token';

/** Aspa opcional, possivelmente escapada uma ou mais vezes (JSON já serializado). */
const Q = String.raw`(?:\\*["'])?`;

/**
 * nome (com ou sem aspas) + separador + valor: entre aspas duplas ou
 * simples (escapadas ou não), "Bearer x"/"Basic x", ou valor simples.
 * Cobre query strings, JSON, cabeçalhos HTTP e aspas simples.
 */
const CREDENTIAL_PARAM_RE = new RegExp(
  String.raw`${Q}\b(?:${CREDENTIAL_NAMES}|key)${Q}\s*[=:]\s*` +
    String.raw`(?:"[^"\\]*"|'[^'\\]*'|\\*["']?(?:(?:bearer|basic)\s+)?[^\s"'\\&,;}]+)`,
  'gi',
);

/** Nome de credencial seguido de separador, em qualquer forma (verificação final). */
const CREDENTIAL_PARAM_FORBIDDEN_RE = new RegExp(String.raw`\b(?:${CREDENTIAL_NAMES})${Q}\s*[=:]`, 'i');

/**
 * Padrões que NUNCA podem aparecer num manifesto serializado. A presença
 * de qualquer um faz serializeRunManifest() lançar (fail-closed).
 */
export const FORBIDDEN_MANIFEST_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'sb_secret', re: /sb_secret_/i },
  { name: 'sb_publishable', re: /sb_publishable_/i },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{4,}/ },
  { name: 'service_role', re: /service_role/i },
  // apikey=, "apikey":, 'secret' :, \"token\": … (qualquer forma, com ou sem aspas)
  { name: 'credential_param', re: CREDENTIAL_PARAM_FORBIDDEN_RE },
  { name: 'bearer', re: /\b(?:bearer|basic)\s+(?!<redacted)[A-Za-z0-9._~+/=-]{6,}/i },
  { name: 'supabase_url', re: /[a-z0-9]{20}\.supabase\.co/i },
  { name: 'env_var_assignment', re: /SUPABASE_SERVICE_KEY\s*=/ },
];

/** Reduz um texto livre (mensagem de erro, etc.) a algo seguro para registar. */
export function sanitizeText(input: string): string {
  let s = input;
  // Segredos conhecidos primeiro (antes de reduzir URLs, que os poderiam conter).
  s = s.replace(/sb_(secret|publishable)_[A-Za-z0-9_-]*/gi, '<redacted>');
  s = s.replace(/eyJ[A-Za-z0-9_-]*(\.[A-Za-z0-9_-]*)*/g, '<redacted>');
  s = s.replace(/\b(bearer|basic)\s+[^\s"',;}]+/gi, '$1 <redacted>');
  // URLs: só o host (nunca caminho, query ou credenciais).
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (url) => {
    try {
      const host = new URL(url).hostname;
      return /\.supabase\.co$/i.test(host) ? '<url:supabase>' : `<url:${host}>`;
    } catch {
      return '<url>';
    }
  });
  s = s.replace(/[a-z0-9]{20}\.supabase\.co/gi, '<supabase-host>');
  // Parâmetros com aspecto de credencial fora de URLs (key=..., token: ...).
  s = s.replace(CREDENTIAL_PARAM_RE, '<redacted-param>');
  s = s.replace(/service_role/gi, '<role>');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
}

/** Aplica sanitizeText() a todas as strings de uma estrutura JSON. */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return sanitizeText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeDeep(v);
    return out as T;
  }
  return value;
}

export class UnsafeManifestError extends Error {
  constructor(pattern: string) {
    super(`[run-manifest] o manifesto contém um padrão proibido (${pattern}); não foi gravado`);
    this.name = 'UnsafeManifestError';
  }
}

/** Serializa (sanitizado) e verifica que nenhum padrão proibido sobrevive. */
export function serializeRunManifest(manifest: RunManifest): string {
  const json = JSON.stringify(sanitizeDeep(manifest), null, 2);
  for (const p of FORBIDDEN_MANIFEST_PATTERNS) if (p.re.test(json)) throw new UnsafeManifestError(p.name);
  return `${json}\n`;
}

/** Grava runs/manifests/<run_id>.json de forma atómica (tmp + rename). Devolve o caminho. */
export function writeRunManifest(dir: string, manifest: RunManifest): string {
  if (!/^[A-Za-z0-9_-]+$/.test(manifest.run_id)) throw new Error(`[run-manifest] run_id inválido: ${manifest.run_id}`);
  const content = serializeRunManifest(manifest);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${manifest.run_id}.json`);
  const tmp = `${file}.partial`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tmp, file);
  return file;
}

/** Lê os manifestos válidos de um directório (ignora ficheiros ilegíveis). Mais recente primeiro. */
export function readRunManifests(dir: string): RunManifest[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: RunManifest[] = [];
  for (const n of names) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as RunManifest;
      if (m && m.schema_version === RUN_MANIFEST_SCHEMA_VERSION && typeof m.region === 'string') out.push(m);
    } catch {
      /* ilegível: ignorado */
    }
  }
  return out.sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0));
}
