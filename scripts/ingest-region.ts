/**
 * scripts/ingest-region.ts — E5: ingestão de uma região.
 *
 *   npx tsx scripts/ingest-region.ts --region <key> [--dry-run] [--since-days=N] [--json]
 *
 * Corre as fontes WordPress da região (src/config/regions.ts) pelo
 * IngestionOrchestrator e imprime o relatório de qualidade (L4) e a
 * saúde das fontes (E7). Google Places é recusado (L5).
 *
 * --dry-run: recolhe e calcula os relatórios sem criar cliente Supabase.
 * Sem --dry-run: grava em staging via RepositoryFactory.forSupabase →
 * getSupabaseClient → envGuard (só staging; produção bloqueada).
 *
 * Código de saída: 0 ok; 1 erro de uso ou fonte falhada; 2 saúde 'critical'.
 */
import { fileURLToPath } from 'node:url';
import { WordPressApiClient } from '../src/collectors/wordpress-content/WordPressApiClient';
import { RepositoryFactory } from '../src/persistence/orchestration/RepositoryFactory';
import { runRegionIngestion, type RegionIngestionDeps, type RegionIngestionResult } from '../src/ingestion/runRegionIngestion';
import { formatRunQualitySummary } from '../src/pipeline/metrics/runQualityMetrics';
import { formatSourceHealthSummary } from '../src/pipeline/health/sourceHealth';
import { formatDiscardReasons } from '../src/ingestion/assisted/runAssisted';

export interface IngestRegionArgs {
  region: string;
  dryRun: boolean;
  sinceDays: number | undefined;
  json: boolean;
}

export function parseIngestRegionArgs(argv: readonly string[]): IngestRegionArgs {
  let region: string | undefined;
  let sinceDays: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--region') region = argv[++i];
    else if (a.startsWith('--region=')) region = a.slice('--region='.length);
    else if (a.startsWith('--since-days=')) {
      sinceDays = Number(a.slice('--since-days='.length));
      if (!Number.isInteger(sinceDays) || sinceDays <= 0) throw new Error('--since-days tem de ser um inteiro positivo');
    } else if (a !== '--dry-run' && a !== '--json') {
      throw new Error(`argumento desconhecido: ${a}`);
    }
  }
  if (!region || region.startsWith('--')) throw new Error('falta --region <key>');
  return { region, dryRun: argv.includes('--dry-run'), sinceDays, json: argv.includes('--json') };
}

export const defaultDeps: RegionIngestionDeps = {
  createRepos: () => RepositoryFactory.forSupabase(),
  createApiClient: (baseUrl) => new WordPressApiClient(baseUrl),
  now: () => new Date().toISOString(),
};

export function exitCodeFor(result: RegionIngestionResult): number {
  if (result.sources.some((s) => s.status === 'failed')) return 1;
  if (result.health.status === 'critical') return 2;
  return 0;
}

export function formatRegionResult(result: RegionIngestionResult): string {
  const lines = [`=== Região ${result.region}${result.dry_run ? ' (dry-run)' : ''} ===`];
  for (const s of result.sources) {
    lines.push(
      s.status === 'success'
        ? `${s.source_key}: recolhidos ${s.summary!.rawItemsCollected}, gravados ${s.summary!.rawItemsPersisted}, staged ${s.summary!.stagedItems}, descartes ${s.summary!.rawItemsErrored}${formatDiscardReasons(s.summary!.rawItemsErroredByReason)}`
        : `${s.source_key}: FALHOU — ${s.error}`,
    );
  }
  for (const r of result.refused_sources) lines.push(`${r.source_key}: recusada — ${r.reason}`);
  lines.push('', formatRunQualitySummary(result.quality), '', formatSourceHealthSummary(result.health));
  return lines.join('\n');
}

async function main(): Promise<number> {
  const args = parseIngestRegionArgs(process.argv.slice(2));
  const result = await runRegionIngestion(args.region, { dryRun: args.dryRun, sinceDays: args.sinceDays }, defaultDeps);
  console.log(args.json ? JSON.stringify(result, null, 2) : formatRegionResult(result));
  return exitCodeFor(result);
}

// Só corre como CLI, nunca quando importado por um teste.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
