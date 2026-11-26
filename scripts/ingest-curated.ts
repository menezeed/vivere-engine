/**
 * Ingestão da CURADORIA manual de actividades 60+ (piloto UK). SÓ STAGING. Idempotente.
 *
 * Lê src/collectors/curated/richmond-curated-60plus.v1.json (factos versionados,
 * revistos em PR): 0 pedidos HTTP. Por omissão é DRY-RUN (sem cliente Supabase).
 *
 *   npx tsx scripts/ingest-curated.ts [--today=YYYY-MM-DD] [--report=<saida.json>]
 *   npx tsx --env-file=<ficheiro de staging> scripts/ingest-curated.ts --apply --confirm=staging --report=<saida.json>
 *
 * Escrita (só com --apply --confirm=staging e depois do seed
 * scripts/staging/fontes-curadoria.staging.sql):
 *   - envGuard (staging); a FK de ingestion_runs garante que a fonte existe;
 *   - uma ingestion_run por fonte; salta séries já em staging (idempotente);
 *   - depois da escrita, uma série duplicada faz falhar;
 *   - tudo em pending_review; nunca aprova, promove nem publica.
 *   - Nunca lê public.sources (o service_role não tem privilégios aí, 0019).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCuratedDataset, planFromCurated } from '../src/collectors/curated/curatedDataset';
import { splitByExisting } from '../src/collectors/fish-ics/fishSnapshot';
import { assertNoRunningRun, stagedCountsBySeries } from '../src/collectors/fish-ics/fishStagingState';
import { crossSourceDuplicates } from '../src/review-api/eligibility/proposal';
import type { RawActivityItem } from '../src/types/RawActivityItem';
import type { SourceConfigContract } from '../src/persistence/types/collectorContracts';

const arg = (argv: readonly string[], name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
export function londonToday(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const DATASET_URL = new URL('../src/collectors/curated/richmond-curated-60plus.v1.json', import.meta.url);

/** Títulos já existentes (u3a dataset auditado + FiSH snapshot) para o relatório de duplicados. */
function existingTitles(): Array<{ title: string; source_key: string; source_item_id: string }> {
  const u3a = JSON.parse(readFileSync(new URL('../src/review-api/eligibility/richmond-u3a-60plus.v1.json', import.meta.url), 'utf8')) as {
    source: string; items: Array<{ source_item_id: string; title: string }>;
  };
  const out = u3a.items.map(i => ({ title: i.title, source_key: u3a.source, source_item_id: i.source_item_id }));
  const FISH = ['Board Games', 'Coffee Corner', 'FiSH Bridge', 'Good Afternoon Choir', 'MeetUpMondays™', 'Picassos in the Park Art',
    'Retro Club East Sheen', 'Singing for the Brain', 'StarFiSH', 'The Reader', 'Tuesday Talk'];
  return [...out, ...FISH.map((t, i) => ({ title: t, source_key: 'fish_neighbourhood_care', source_item_id: `fish:${i}` }))];
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const apply = argv.includes('--apply');
  if (apply && arg(argv, 'confirm') !== 'staging') throw new Error('RECUSA: --apply exige --confirm=staging');
  const today = arg(argv, 'today') ?? londonToday();
  const reportPath = arg(argv, 'report');
  const datasetPath = arg(argv, 'dataset') ?? fileURLToPath(DATASET_URL);

  const ds = parseCuratedDataset(JSON.parse(readFileSync(datasetPath, 'utf8')));
  const plan = planFromCurated(ds, today);

  const db = apply ? await (await import('../src/persistence/client/supabase')).getSupabaseClient() : null;
  const perSource: Record<string, unknown> = {};
  const duplicatedInStaging: string[] = [];
  let written = 0;

  for (const [sourceKey, items] of plan.bySource) {
    const planned = items.map(i => i.source_item_id);
    let existing = new Set<string>();
    if (db) {
      await assertNoRunningRun(db, sourceKey);
      const before = await stagedCountsBySeries(db, sourceKey, ds.product, planned);
      existing = new Set([...before].filter(([, n]) => n > 0).map(([id]) => id));
    }
    const { insert, skip } = splitByExisting(items, existing);
    let summary: unknown = null;
    if (db && insert.length > 0) {
      const { reposForRun } = await import('../src/persistence/orchestration/reposForRun');
      const { IngestionOrchestrator } = await import('../src/persistence/orchestration/IngestionOrchestrator');
      const orchestrator = new IngestionOrchestrator(await reposForRun(false));
      const collector = { sourceKey, collect: async () => ({ items: insert as RawActivityItem[], errors: [] }) };
      const cfg: SourceConfigContract = { source_key: sourceKey, product_key: ds.product };
      summary = await orchestrator.runActivityIngestion(collector, cfg, { dryRun: false });
      written += (summary as { stagedItems?: number }).stagedItems ?? 0;
    }
    if (db) {
      const after = await stagedCountsBySeries(db, sourceKey, ds.product, planned);
      duplicatedInStaging.push(...[...after].filter(([, n]) => n > 1).map(([id]) => `${sourceKey}/${id}`));
    }
    perSource[sourceKey] = {
      a_inserir: insert.length, ja_existentes_saltadas: skip.length,
      ocorrencias_a_inserir: insert.reduce((n, i) => n + i.occurrences.length, 0),
      resultado_escrita: summary,
      insercoes: insert.map(i => ({
        source_item_id: i.source_item_id, titulo: i.title, datas: i.occurrences.map(o => o.date),
        horario: `${i.occurrences[0]?.time}${i.occurrences[0]?.end_time ? `–${i.occurrences[0].end_time}` : ''}`,
        recorrencia: i.recurrence_text_hint, local: `${i.venue_mention?.raw_text} (${i.raw_payload['postcode']})`,
        custo: i.price_text, url: i.external_url,
        elegibilidade: (i.raw_payload['eligibility_proposal'] as { classification: string }).classification,
        publico_restrito: i.raw_payload['restricted_audience'] ?? null,
      })),
    };
  }

  const all = [...plan.bySource.values()].flat();
  const duplicates = crossSourceDuplicates(all.map(i => ({ title: i.title, source_key: i.source_key, source_item_id: i.source_item_id })), existingTitles(), 0.5);
  const byClass = plan.proposals.reduce<Record<string, number>>((m, p) => (m[p.classification] = (m[p.classification] ?? 0) + 1, m), {});

  const report = {
    gerado_em: new Date().toISOString(),
    modo: apply ? 'ESCRITA EM STAGING' : 'DRY-RUN (sem escrita, sem cliente Supabase)',
    escrita_efetuada: written > 0,
    linhas_gravadas: written,
    hoje: today,
    dataset: { verificado_em: ds.verified_at, itens: ds.items.length, excluidos_na_curadoria: ds.excluded, pedidos_http_nesta_execucao: 0 },
    produto: ds.product,
    proposta_elegibilidade: byClass,
    possiveis_duplicados: duplicates.map(d => ({ novo: `${d.candidate.source_key}: ${d.candidate.title}`, existente: `${d.existing.source_key}: ${d.existing.title}`, motivo: d.reason, semelhanca: Number(d.similarity.toFixed(2)) })),
    fora_da_insercao: plan.held,
    por_fonte: perSource,
    duplicados_em_staging_apos_escrita: duplicatedInStaging,
  };
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(written > 0 ? `GRAVADO EM STAGING: ${written} actividade(s).` : (apply ? 'NADA FOI GRAVADO (tudo já existia).' : 'NADA FOI GRAVADO: a_inserir é uma previsão.'));
  console.log(JSON.stringify({ modo: report.modo, proposta_elegibilidade: byClass, possiveis_duplicados: report.possiveis_duplicados,
    por_fonte: Object.fromEntries(Object.entries(perSource).map(([k, v]) => [k, { a_inserir: (v as { a_inserir: number }).a_inserir, ocorrencias: (v as { ocorrencias_a_inserir: number }).ocorrencias_a_inserir }])) }, null, 2));
  if (duplicatedInStaging.length > 0) throw new Error(`ERRO: séries duplicadas depois da escrita: ${duplicatedInStaging.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
}
