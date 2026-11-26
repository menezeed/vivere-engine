/**
 * Ingestão da FiSH Neighbourhood Care — piloto UK. SÓ STAGING. Idempotente.
 *
 * Usa EXCLUSIVAMENTE o snapshot já recolhido (relatório do preview-fish.ts):
 * zero pedidos HTTP à FiSH. Por omissão é DRY-RUN (sem cliente Supabase).
 *
 *   npx tsx scripts/ingest-fish.ts --snapshot=<preview-fish.json> [--today=YYYY-MM-DD] [--report=<saida.json>]
 *   npx tsx --env-file=<ficheiro fora do repo> scripts/ingest-fish.ts --snapshot=<…> --apply --confirm=staging
 *
 * Escrita (só com --apply --confirm=staging, e depois do seed
 * scripts/staging/fonte-fish.staging.sql):
 *   - envGuard (RepositoryFactory.forSupabase) recusa produção;
 *   - recusa se a fonte fish_neighbourhood_care não existir;
 *   - idempotência: séries já presentes em staging (mesma fonte, mesmo
 *     source_item_id, produto do piloto) são saltadas — correr duas vezes
 *     não duplica nada; sem nada para inserir, não abre ingestion_run;
 *   - tudo entra como pending_review / venue unresolved. Nunca aprova,
 *     promove nem publica (publicationGuard bloqueia produtos não-BR).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePreviewSnapshot, planFromSnapshot, splitByExisting } from '../src/collectors/fish-ics/fishSnapshot';
import { FISH_CONFIG } from '../src/collectors/fish-ics/config';
import { detectRecurrenceItems } from '../src/pipeline/stages/02-recurrence-detection';
import { crossSourceDuplicates } from '../src/review-api/eligibility/proposal';
import type { RawActivityItem } from '../src/types/RawActivityItem';
import type { SourceConfigContract } from '../src/persistence/types/collectorContracts';
import { assertNoRunningRun, stagedCountsBySeries } from '../src/collectors/fish-ics/fishStagingState';

const arg = (argv: readonly string[], name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export function londonToday(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function stagingDb() {
  const { getSupabaseClient } = await import('../src/persistence/client/supabase');
  return getSupabaseClient(); // envGuard: só staging
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const snapshotPath = arg(argv, 'snapshot');
  if (!snapshotPath) throw new Error('--snapshot=<preview-fish.json> é obrigatório');
  const apply = argv.includes('--apply');
  if (apply && arg(argv, 'confirm') !== 'staging') throw new Error('RECUSA: --apply exige --confirm=staging');
  const today = arg(argv, 'today') ?? londonToday();
  const reportPath = arg(argv, 'report');

  const snapshot = parsePreviewSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')));
  const plan = planFromSnapshot(snapshot, today);

  const planned = plan.items.map(i => i.source_item_id);
  const db = apply ? await stagingDb() : null;
  let existing = new Set<string>();
  if (db) {
    await assertNoRunningRun(db, FISH_CONFIG.source_key);
    const before = await stagedCountsBySeries(db, FISH_CONFIG.source_key, FISH_CONFIG.product_key, planned);
    existing = new Set([...before].filter(([, n]) => n > 0).map(([id]) => id));
  }
  const { insert, skip } = splitByExisting(plan.items, existing);

  const u3a = JSON.parse(readFileSync(new URL('../src/review-api/eligibility/richmond-u3a-60plus.v1.json', import.meta.url), 'utf8')) as {
    source: string; items: Array<{ source_item_id: string; title: string }>;
  };
  const duplicates = crossSourceDuplicates(
    plan.items.map(i => ({ title: i.title, source_key: FISH_CONFIG.source_key, source_item_id: i.source_item_id })),
    u3a.items.map(i => ({ title: i.title, source_key: u3a.source, source_item_id: i.source_item_id })),
  );
  const recurrence = detectRecurrenceItems(insert);
  const byClass = plan.proposals.reduce<Record<string, number>>((m, p) => (m[p.classification] = (m[p.classification] ?? 0) + 1, m), {});

  let summary: unknown = null;
  if (apply && insert.length > 0) {
    const { reposForRun } = await import('../src/persistence/orchestration/reposForRun');
    const { IngestionOrchestrator } = await import('../src/persistence/orchestration/IngestionOrchestrator');
    const orchestrator = new IngestionOrchestrator(await reposForRun(false));
    const collector = { sourceKey: FISH_CONFIG.source_key, collect: async () => ({ items: insert as RawActivityItem[], errors: [] }) };
    const sourceConfig: SourceConfigContract = { source_key: FISH_CONFIG.source_key, product_key: FISH_CONFIG.product_key };
    summary = await orchestrator.runActivityIngestion(collector, sourceConfig, { dryRun: false });
  }
  // Verificação depois da escrita (concorrência): nenhuma série pode ficar duplicada.
  let duplicatedInStaging: string[] = [];
  if (db) {
    const after = await stagedCountsBySeries(db, FISH_CONFIG.source_key, FISH_CONFIG.product_key, planned);
    duplicatedInStaging = [...after].filter(([, n]) => n > 1).map(([id]) => id);
  }

  const report = {
    gerado_em: new Date().toISOString(),
    modo: apply ? 'ESCRITA EM STAGING' : 'DRY-RUN (sem escrita, sem cliente Supabase)',
    // Inequívoco: em dry-run, a_inserir é uma PREVISÃO; nada foi gravado.
    escrita_efetuada: summary !== null,
    linhas_gravadas: summary === null ? 0 : (summary as { stagedItems?: number }).stagedItems ?? null,
    hoje: today,
    snapshot: { ficheiro: snapshotPath, recolhido_em: snapshot.gerado_em, pedidos_http_nesta_execucao: 0 },
    produto: FISH_CONFIG.product_key,
    fonte: FISH_CONFIG.source_key,
    contagens: {
      series_no_snapshot: snapshot.atividades.length,
      fundidas: plan.merged.reduce((n, m) => n + m.from.length - 1, 0),
      fora_da_insercao: plan.held.length,
      ocorrencias_passadas_removidas: plan.past_occurrences_removed,
      a_inserir: insert.length,
      ja_existentes_saltadas: skip.length,
      ocorrencias_a_inserir: insert.reduce((n, i) => n + i.occurrences.length, 0),
      proposta_elegibilidade: byClass,
      duplicados_u3a: duplicates.length,
    },
    linhas_previstas: {
      'public.sources (o script nunca escreve; seed separado)': 0,
      'staging.ingestion_runs': insert.length > 0 ? 1 : 0,
      'staging.raw_activity_items': insert.length,
      'staging.activities_staging (pending_review, venue unresolved)': insert.length,
      'staging.venues_staging': 0,
    },
    fundidas: plan.merged,
    fora_da_insercao: plan.held,
    insercoes: recurrence.map(({ item, recurrence: r }) => ({
      source_item_id: item.source_item_id,
      titulo: item.title,
      datas: item.occurrences.map(o => o.date),
      horario: `${item.occurrences[0]?.time ?? 'sem hora'}${item.occurrences[0]?.end_time ? `–${item.occurrences[0].end_time}` : ''}`,
      recorrencia_detectada: r,
      local: item.venue_mention ? `${item.venue_mention.raw_text} (${(item.raw_payload['postcode'] as string | null) ?? 'sem código postal'})` : null,
      custo: item.price_text,
      reserva: item.raw_payload['booking'],
      url: item.external_url,
      elegibilidade: (item.raw_payload['eligibility_proposal'] as { classification: string }).classification,
    })),
    resultado_escrita: summary,
    duplicados_em_staging_apos_escrita: duplicatedInStaging,
  };

  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(summary === null ? 'NADA FOI GRAVADO: a_inserir é uma previsão.' : `GRAVADO EM STAGING: ${report.linhas_gravadas} actividade(s).`);
  console.log(JSON.stringify({ modo: report.modo, escrita_efetuada: report.escrita_efetuada, contagens: report.contagens, linhas_previstas: report.linhas_previstas, resultado_escrita: summary }, null, 2));
  if (reportPath) console.log(`Relatório: ${reportPath}`);
  if (duplicatedInStaging.length > 0) {
    throw new Error(`ERRO: séries duplicadas em activities_staging depois da escrita (execução concorrente?): ${duplicatedInStaging.join(', ')}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
}
