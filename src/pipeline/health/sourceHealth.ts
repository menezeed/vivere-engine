/**
 * src/pipeline/health/sourceHealth.ts
 *
 * E7 — saúde das fontes. Função PURA: recebe o relatório L4
 * (computeRunQualityMetrics) de uma execução, opcionalmente o da
 * execução anterior, o estado das execuções (ingestion_runs) e a data
 * do último post de cada fonte, e devolve alertas estruturados.
 *
 * Não faz I/O, não lê o relógio (now é parâmetro) e NÃO envia
 * notificações: só produz a estrutura (JSON + resumo legível). Quem
 * chama decide o que fazer com ela.
 *
 * Alertas:
 *   zero_items         (critical) fonte esperada sem nenhum item nesta execução
 *   volume_drop        (warning)  queda > dropPct face à execução anterior
 *   high_no_date_rate  (warning)  % de itens sem data acima de maxNoDatePct
 *   run_failed         (critical) execução com status 'failed'
 *   run_partial        (warning)  execução com status 'partial'
 *   run_open           (critical) execução 'running' sem fim há mais de maxRunningHours
 *   stale_source       (warning)  último post da fonte há mais de staleDays dias
 *
 * Uma fonte é "esperada" se aparece em options.expectedSources, no
 * relatório anterior ou nas execuções fornecidas — o relatório L4 só
 * tem grupos para fontes com ≥1 item, por isso 0 itens = ausência.
 */
import type { RunQualityReport } from '../metrics/runQualityMetrics';

export type Severity = 'critical' | 'warning';

export type AlertCode =
  | 'zero_items'
  | 'volume_drop'
  | 'high_no_date_rate'
  | 'run_failed'
  | 'run_partial'
  | 'run_open'
  | 'stale_source';

export interface SourceHealthAlert {
  source_key: string;
  code: AlertCode;
  severity: Severity;
  message: string;
  data: Record<string, string | number | null>;
}

/** Espelha staging.ingestion_runs (status, started_at, finished_at). */
export interface SourceRunInfo {
  source_key: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string | null;
  error_message?: string | null;
}

export interface SourceHealthThresholds {
  /** Queda percentual face à execução anterior que gera volume_drop. Default 50. */
  dropPct: number;
  /** Volume mínimo da execução anterior para avaliar queda (evita ruído em volumes pequenos). Default 4. */
  minPreviousForDrop: number;
  /** % máxima de itens sem data. Default 50. */
  maxNoDatePct: number;
  /** Nº mínimo de itens da fonte para avaliar a % sem data. Default 2. */
  minItemsForNoDate: number;
  /**
   * Dias sem post novo que geram stale_source. Default 14: Cabo Frio
   * publica 1–2 por semana (L1); 2 semanas sem nada é anómalo. Fontes
   * irregulares (São Pedro da Aldeia) vão disparar — é intencional.
   */
  staleDays: number;
  /** Horas que uma execução pode ficar 'running' antes de run_open. Default 6 (execução manual por CLI, minutos). */
  maxRunningHours: number;
}

export const DEFAULT_SOURCE_HEALTH_THRESHOLDS: Readonly<SourceHealthThresholds> = Object.freeze({
  dropPct: 50,
  minPreviousForDrop: 4,
  maxNoDatePct: 50,
  minItemsForNoDate: 2,
  staleDays: 14,
  maxRunningHours: 6,
});

export interface SourceHealthInput {
  current: RunQualityReport;
  previous?: RunQualityReport | null;
  runs?: readonly SourceRunInfo[];
  /** Data (ISO 8601) do último post publicado por fonte, se conhecida. */
  lastPublishedAt?: Readonly<Record<string, string | null>>;
  expectedSources?: readonly string[];
  /** ISO 8601 — obrigatório, para a função ser determinística. */
  now: string;
  thresholds?: Partial<SourceHealthThresholds>;
}

export interface SourceHealthEntry {
  source_key: string;
  city: string | null;
  status: 'ok' | Severity;
  total_items: number;
  alerts: SourceHealthAlert[];
}

export interface SourceHealthReport {
  generated_at: string;
  run_id: string | null;
  thresholds: SourceHealthThresholds;
  status: 'ok' | Severity;
  sources: SourceHealthEntry[];
  alerts: SourceHealthAlert[];
  notes: string[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function worst(alerts: readonly SourceHealthAlert[]): 'ok' | Severity {
  if (alerts.some((a) => a.severity === 'critical')) return 'critical';
  if (alerts.length > 0) return 'warning';
  return 'ok';
}

export function evaluateSourceHealth(input: SourceHealthInput): SourceHealthReport {
  const t: SourceHealthThresholds = { ...DEFAULT_SOURCE_HEALTH_THRESHOLDS, ...input.thresholds };
  const now = Date.parse(input.now);
  if (Number.isNaN(now)) throw new Error(`evaluateSourceHealth: now inválido ("${input.now}")`);
  const notes: string[] = [];

  const currentBy = new Map(input.current.by_group.map((g) => [g.source_key, g]));
  const previousBy = new Map((input.previous?.by_group ?? []).map((g) => [g.source_key, g]));
  const runs = input.runs ?? [];

  const keys = new Set<string>([
    ...currentBy.keys(),
    ...previousBy.keys(),
    ...(input.expectedSources ?? []),
    ...runs.map((r) => r.source_key),
  ]);

  const sources: SourceHealthEntry[] = [...keys].sort((a, b) => a.localeCompare(b)).map((sourceKey) => {
    const cur = currentBy.get(sourceKey);
    const prev = previousBy.get(sourceKey);
    const total = cur?.total_items ?? 0;
    const alerts: SourceHealthAlert[] = [];
    const add = (code: AlertCode, severity: Severity, message: string, data: SourceHealthAlert['data']): void => {
      alerts.push({ source_key: sourceKey, code, severity, message, data });
    };

    // Volume
    if (total === 0) {
      add('zero_items', 'critical', 'a fonte não devolveu nenhum item nesta execução', {
        previous_items: prev?.total_items ?? null,
      });
    } else if (prev && prev.total_items >= t.minPreviousForDrop) {
      const dropPct = ((prev.total_items - total) / prev.total_items) * 100;
      if (dropPct > t.dropPct) {
        add('volume_drop', 'warning', `queda de ${round1(dropPct)}% face à execução anterior`, {
          previous_items: prev.total_items,
          current_items: total,
          drop_pct: round1(dropPct),
          threshold_pct: t.dropPct,
        });
      }
    }

    // Qualidade: itens sem data
    // Decide pelo quociente dos counts; a % do L4 já vem arredondada a
    // 1 casa e mudaria a decisão junto ao limiar (revisão r0 do #12).
    if (cur && cur.total_items > 0 && cur.total_items >= t.minItemsForNoDate) {
      const withoutDate = cur.total_items - cur.with_date.count;
      const noDateExactPct = (withoutDate / cur.total_items) * 100;
      if (noDateExactPct > t.maxNoDatePct) {
        const noDatePct = round1(noDateExactPct); // só para mensagem e dados
        add('high_no_date_rate', 'warning', `${noDatePct}% dos itens sem data`, {
          items: cur.total_items,
          items_without_date: withoutDate,
          no_date_pct: noDatePct,
          threshold_pct: t.maxNoDatePct,
        });
      }
    }

    // Execuções
    for (const run of runs.filter((r) => r.source_key === sourceKey)) {
      if (run.status === 'failed') {
        add('run_failed', 'critical', 'execução falhada', {
          started_at: run.started_at,
          error_message: run.error_message ?? null,
        });
      } else if (run.status === 'partial') {
        add('run_partial', 'warning', 'execução terminou parcialmente', { started_at: run.started_at });
      } else if (run.status === 'running' && run.finished_at === null) {
        const started = Date.parse(run.started_at);
        if (Number.isNaN(started)) {
          notes.push(`${sourceKey}: started_at inválido numa execução 'running' — ignorada`);
        } else {
          const hours = (now - started) / HOUR_MS;
          if (hours > t.maxRunningHours) {
            add('run_open', 'critical', `execução aberta há ${round1(hours)} h`, {
              started_at: run.started_at,
              open_hours: round1(hours),
              threshold_hours: t.maxRunningHours,
            });
          }
        }
      }
    }

    // Frescura da fonte
    const last = input.lastPublishedAt?.[sourceKey];
    if (last !== undefined && last !== null) {
      const lastMs = Date.parse(last);
      if (Number.isNaN(lastMs)) {
        notes.push(`${sourceKey}: data do último post inválida ("${last}") — frescura não avaliada`);
      } else {
        const days = (now - lastMs) / DAY_MS;
        if (days > t.staleDays) {
          add('stale_source', 'warning', `sem publicação nova há ${Math.floor(days)} dias`, {
            last_published_at: last,
            days_since: Math.floor(days),
            threshold_days: t.staleDays,
          });
        }
      }
    }

    return { source_key: sourceKey, city: cur?.city ?? prev?.city ?? null, status: worst(alerts), total_items: total, alerts };
  });

  if (!input.previous) notes.push('sem relatório anterior: queda de volume não avaliada');
  if (!input.lastPublishedAt) notes.push('sem data do último post: frescura não avaliada');

  const severityRank = (s: Severity): number => (s === 'critical' ? 0 : 1);
  const alerts = sources
    .flatMap((s) => s.alerts)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.source_key.localeCompare(b.source_key));

  return {
    generated_at: input.now,
    run_id: input.current.run_id,
    thresholds: t,
    status: worst(alerts),
    sources,
    alerts,
    notes,
  };
}

/** Resumo legível (pt). */
export function formatSourceHealthSummary(report: SourceHealthReport): string {
  const label = { ok: 'OK', warning: 'AVISO', critical: 'CRÍTICO' } as const;
  const lines = [`Saúde das fontes — execução ${report.run_id ?? '(sem id)'} — ${report.generated_at}: ${label[report.status]}`];
  for (const s of report.sources) {
    lines.push(`${label[s.status]} ${s.source_key} (${s.city ?? 'cidade desconhecida'}): ${s.total_items} itens`);
    for (const a of s.alerts) lines.push(`  - [${a.code}] ${a.message}`);
  }
  for (const n of report.notes) lines.push(`nota: ${n}`);
  return lines.join('\n');
}
