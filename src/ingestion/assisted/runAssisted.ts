/**
 * E4 — execução MANUAL ASSISTIDA de uma região (ADR rascunho do agendador,
 * opção D). Sem agendamento.
 *
 *   pré-voo (sem rede) → lock da região → runRegionIngestion (E5, com
 *   retry SÓ de erros transitórios nos pedidos WordPress) → manifesto
 *   auditável em runs/manifests/ → resumo no stdout.
 *
 * Códigos de saída: 0 ok; 1 alguma fonte falhou (ou erro inesperado);
 * 2 saúde E7 'critical'; 3 recusado (pré-voo ou lock ocupado).
 *
 * Todas as dependências com efeitos são injectadas: os testes usam
 * repositórios em memória, clientes falsos e directórios temporários.
 */
import { REGIONS, type RegionDefinition } from '../../config/regions';
import { runRegionIngestion, planRegionSources, type RegionIngestionDeps, type RegionIngestionResult } from '../runRegionIngestion';
import { formatRunQualitySummary, type RunQualityReport } from '../../pipeline/metrics/runQualityMetrics';
import { formatSourceHealthSummary } from '../../pipeline/health/sourceHealth';
import { runPreflight, formatPreflight, type PreflightDeps, type PreflightInput, type PreflightResult } from './preflight';
import { acquireRegionLock, RegionLockedError, type RegionLock } from './runLock';
import {
  sanitizeText,
  writeRunManifest,
  RUN_MANIFEST_SCHEMA_VERSION,
  type ManifestSourceEntry,
  type RunManifest,
} from './runManifest';
import {
  classifyIngestionError,
  retryingApiClient,
  DEFAULT_TRANSIENT_RETRY_POLICY,
  realSleep,
  type Sleep,
  type TransientRetryPolicy,
} from './transientErrors';

export const EXIT_OK = 0;
export const EXIT_SOURCE_FAILED = 1;
export const EXIT_HEALTH_CRITICAL = 2;
export const EXIT_REFUSED = 3;

export interface AssistedRunArgs extends PreflightInput {
  sinceDays?: number;
  /** Só o checklist; não adquire lock, não corre nada, não grava manifesto. */
  preflightOnly: boolean;
}

export interface AssistedRunDeps {
  ingestion: Omit<RegionIngestionDeps, 'regions'>;
  preflight: Omit<PreflightDeps, 'regions'>;
  regions?: readonly RegionDefinition[];
  manifestsDir: string;
  locksDir: string;
  gitCommit: () => string | null;
  /** Sufixo aleatório curto do run_id ([a-z0-9]). */
  randomSuffix: () => string;
  retryPolicy?: TransientRetryPolicy;
  sleep?: Sleep;
  lock?: { pid?: number; isProcessAlive?: (pid: number) => boolean; staleAfterMs?: number };
}

export interface AssistedRunOutput {
  exitCode: number;
  text: string;
  manifest: RunManifest | null;
  manifestPath: string | null;
  preflight: PreflightResult;
}

export function makeRunId(startedAtIso: string, region: string, suffix: string): string {
  const compact = startedAtIso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${compact}_${region}_${suffix.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`;
}

export function exitCodeForResult(result: RegionIngestionResult): number {
  if (result.sources.some((s) => s.status === 'failed')) return EXIT_SOURCE_FAILED;
  if (result.health.status === 'critical') return EXIT_HEALTH_CRITICAL;
  return EXIT_OK;
}

function findPreviousQuality(manifests: readonly RunManifest[], region: string, sources: readonly string[]): RunQualityReport | null {
  const key = [...sources].sort().join(',');
  for (const m of manifests) {
    if (m.region !== region || !m.quality || m.outcome === 'refused' || m.outcome === 'error') continue;
    if ([...m.sources_attempted].sort().join(',') === key) return m.quality;
  }
  return null;
}

function baseManifest(args: AssistedRunArgs, runId: string, startedAt: string, pre: PreflightResult, gitCommit: string | null): RunManifest {
  return {
    schema_version: RUN_MANIFEST_SCHEMA_VERSION,
    run_id: runId,
    started_at: startedAt,
    finished_at: startedAt,
    git: { commit: gitCommit, dirty: pre.gitDirty },
    region: args.region,
    dry_run: args.dryRun,
    target_environment: args.dryRun ? null : pre.targetEnvironment,
    since_days: args.sinceDays ?? null,
    sources_attempted: [],
    sources: pre.skipped.map((s) => skippedEntry(s.source_key, s.reason)),
    totals: { sources_ok: 0, sources_failed: 0, sources_skipped: pre.skipped.length, collected: 0, persisted: 0, staged: 0 },
    quality: null,
    health: null,
    preflight: pre.checks,
    outcome: 'refused',
    exit_code: EXIT_REFUSED,
    reason: null,
  };
}

function skippedEntry(source_key: string, reason: string): ManifestSourceEntry {
  return { source_key, status: 'skipped', error_class: null, error_message: null, skip_reason: reason, retries: 0, counts: null, ingestion_run_id: null };
}

export function formatAssistedSummary(m: RunManifest, manifestPath: string | null): string {
  const lines = [
    `=== Execução assistida ${m.run_id} ===`,
    `região: ${m.region} | modo: ${m.dry_run ? 'dry-run (sem escrita)' : `escrita em ${m.target_environment}`} | commit: ${m.git.commit ?? 'desconhecido'}${m.git.dirty ? ' (árvore suja)' : ''}`,
    `início: ${m.started_at} | fim: ${m.finished_at} (UTC)`,
  ];
  for (const s of m.sources) {
    if (s.status === 'ok') {
      const c = s.counts!;
      lines.push(`OK      ${s.source_key}: recolhidos ${c.collected}, gravados ${c.persisted}, staged ${c.staged}, descartes ${c.discarded}${s.retries ? `, retries ${s.retries}` : ''}`);
    } else if (s.status === 'failed') {
      lines.push(`FALHOU  ${s.source_key}: [${s.error_class}] ${sanitizeText(s.error_message ?? '')}${s.retries ? ` (após ${s.retries} retries)` : ''}`);
    } else {
      lines.push(`IGNORADA ${s.source_key}: ${s.skip_reason}`);
    }
  }
  if (m.quality) lines.push('', formatRunQualitySummary(m.quality));
  if (m.health) lines.push('', formatSourceHealthSummary(m.health));
  if (m.reason) lines.push('', `motivo: ${sanitizeText(m.reason)}`);
  const verdict = {
    ok: 'OK',
    failed: 'FALHA: pelo menos uma fonte falhou — ver acima e o runbook',
    critical: 'CRÍTICO: saúde E7 critical — ver alertas',
    refused: 'RECUSADO: nada foi executado',
    error: 'ERRO inesperado — ver motivo',
  }[m.outcome];
  lines.push('', `resultado: ${verdict} (código ${m.exit_code})`);
  if (manifestPath) lines.push(`manifesto: ${manifestPath}`);
  return lines.join('\n');
}

export async function runAssistedIngestion(args: AssistedRunArgs, deps: AssistedRunDeps): Promise<AssistedRunOutput> {
  const regions = deps.regions ?? REGIONS;
  const startedAt = deps.ingestion.now();
  const pre = runPreflight(args, { ...deps.preflight, regions });

  if (args.preflightOnly) {
    return { exitCode: pre.ok ? EXIT_OK : EXIT_REFUSED, text: formatPreflight(pre, args), manifest: null, manifestPath: null, preflight: pre };
  }

  const runId = makeRunId(startedAt, /^[a-z][a-z0-9_]*$/.test(args.region) ? args.region : 'invalid', deps.randomSuffix());
  const manifest = baseManifest(args, runId, startedAt, pre, deps.gitCommit());

  const finish = (): AssistedRunOutput => {
    manifest.finished_at = deps.ingestion.now();
    const manifestPath = writeRunManifest(deps.manifestsDir, manifest);
    const text = [manifest.outcome === 'refused' ? formatPreflight(pre, args) : null, formatAssistedSummary(manifest, manifestPath)]
      .filter(Boolean)
      .join('\n\n');
    return { exitCode: manifest.exit_code, text, manifest, manifestPath, preflight: pre };
  };

  if (!pre.ok || !pre.region) {
    manifest.reason = `pré-voo recusado: ${pre.checks.filter((c) => c.status === 'fail').map((c) => c.id).join(', ')}`;
    return finish();
  }

  let lock: RegionLock;
  try {
    lock = acquireRegionLock({ dir: deps.locksDir, region: pre.region.key, runId, nowMs: () => Date.parse(deps.ingestion.now()), ...deps.lock });
  } catch (err) {
    if (!(err instanceof RegionLockedError)) throw err;
    manifest.reason = err.message;
    return finish();
  }

  try {
    const effectiveRegion: RegionDefinition = { ...pre.region, sources: pre.runSources };
    const baseUrlToSource = new Map(planRegionSources(effectiveRegion).planned.map((p) => [p.config.base_url, p.sourceKey]));
    const retries = new Map<string, number>();
    const ingestionDeps: RegionIngestionDeps = {
      ...deps.ingestion,
      regions: regions.map((r) => (r.key === effectiveRegion.key ? effectiveRegion : r)),
      createApiClient: (baseUrl) => {
        const sourceKey = baseUrlToSource.get(baseUrl) ?? baseUrl;
        return retryingApiClient(deps.ingestion.createApiClient(baseUrl), deps.retryPolicy ?? DEFAULT_TRANSIENT_RETRY_POLICY, deps.sleep ?? realSleep, () =>
          retries.set(sourceKey, (retries.get(sourceKey) ?? 0) + 1),
        );
      },
    };
    const previousReport = findPreviousQuality(deps.preflight.previousManifests(), effectiveRegion.key, pre.runSources);

    manifest.sources_attempted = [...pre.runSources];
    const result = await runRegionIngestion(effectiveRegion.key, { dryRun: args.dryRun, sinceDays: args.sinceDays, previousReport }, ingestionDeps);

    const entries: ManifestSourceEntry[] = result.sources.map((s) => ({
      source_key: s.source_key,
      status: s.status === 'success' ? 'ok' : 'failed',
      error_class: s.status === 'failed' ? classifyIngestionError(new Error(s.error ?? '')) : null,
      error_message: s.status === 'failed' ? sanitizeText(s.error ?? '') : null,
      skip_reason: null,
      retries: retries.get(s.source_key) ?? 0,
      counts: s.summary
        ? { collected: s.summary.rawItemsCollected, persisted: s.summary.rawItemsPersisted, staged: s.summary.stagedItems, discarded: s.summary.rawItemsErrored }
        : null,
      ingestion_run_id: s.summary?.ingestionRunId ?? null,
    }));
    manifest.sources = [...entries, ...manifest.sources];
    const ok = entries.filter((e) => e.status === 'ok');
    manifest.totals = {
      sources_ok: ok.length,
      sources_failed: entries.length - ok.length,
      sources_skipped: pre.skipped.length,
      collected: ok.reduce((n, e) => n + e.counts!.collected, 0),
      persisted: ok.reduce((n, e) => n + e.counts!.persisted, 0),
      staged: ok.reduce((n, e) => n + e.counts!.staged, 0),
    };
    manifest.quality = result.quality;
    manifest.health = result.health;
    manifest.exit_code = exitCodeForResult(result);
    manifest.outcome = manifest.exit_code === EXIT_SOURCE_FAILED ? 'failed' : manifest.exit_code === EXIT_HEALTH_CRITICAL ? 'critical' : 'ok';
  } catch (err) {
    manifest.outcome = 'error';
    manifest.exit_code = EXIT_SOURCE_FAILED;
    const cls = classifyIngestionError(err);
    const message = err instanceof Error ? err.message : String(err);
    // Do envGuard só o código: as mensagens podem citar refs/URLs do ambiente.
    manifest.reason =
      cls === 'env_guard' ? `[env_guard] ${/\[envGuard:([A-Z_]+)\]/.exec(message)?.[1] ?? 'erro'}` : `[${cls}] ${sanitizeText(message)}`;
  } finally {
    lock.release();
  }
  return finish();
}
