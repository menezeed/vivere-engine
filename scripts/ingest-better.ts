/**
 * Ingestão da Better (GLL) via OpenActive — piloto UK. SÓ STAGING. Idempotente.
 *
 * Usa EXCLUSIVAMENTE o snapshot do preview-better.ts: zero pedidos HTTP.
 * Por omissão é DRY-RUN (sem cliente Supabase). As ocorrências são geradas
 * a partir do horário estruturado do snapshot para os 21 dias a contar de
 * --today (hora local de Londres).
 *
 * Com --sessions=<better-sessions-state.json> (harvest-better-sessions.ts) e
 * reached_end = true, as ocorrências vêm das sessões agendadas futuras
 * confirmadas; série sem nenhuma fica fora. Harvest incompleto: --apply recusado.
 *
 *   npx tsx scripts/ingest-better.ts --snapshot=<better-preview.json> [--sessions=<estado.json>] [--today=YYYY-MM-DD] [--report=<saida.json>]
 *   npx tsx --env-file=<ficheiro fora do repo> scripts/ingest-better.ts --snapshot=<…> --apply --confirm=staging
 *
 * Escrita (só com --apply --confirm=staging, depois do seed
 * scripts/staging/fonte-better.staging.sql):
 *   - envGuard (getSupabaseClient) recusa produção;
 *   - recusa um snapshot com feed incompleto (apagamentos podem faltar);
 *   - recusa se houver um ingestion_run "running" da fonte;
 *   - idempotência por série (lê só staging.*; nunca public.sources);
 *   - verificação depois da escrita: série duplicada → exit 1;
 *   - tudo entra como pending_review / venue unresolved. Nunca aprova nem publica.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BETTER_CONFIG } from '../src/collectors/openactive-better/config';
import { parseBetterSnapshot } from '../src/collectors/openactive-better/betterFeed';
import { londonToday, planFromSeries, splitByExisting } from '../src/collectors/openactive-better/betterSeries';
import { pilotDuplicates, type U3aDataset } from '../src/collectors/openactive-better/betterDedup';
import { applyConfirmedSessions, confirmedFutureBySeries, parseSessionsState } from '../src/collectors/openactive-better/betterSessions';
import { assertNoRunningRun, stagedCountsBySeries } from '../src/collectors/fish-ics/fishStagingState';
import { detectRecurrenceItems } from '../src/pipeline/stages/02-recurrence-detection';
import type { RawActivityItem } from '../src/types/RawActivityItem';
import type { SourceConfigContract } from '../src/persistence/types/collectorContracts';

const arg = (argv: readonly string[], name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function stagingDb() {
  const { getSupabaseClient } = await import('../src/persistence/client/supabase');
  return getSupabaseClient(); // envGuard: só staging
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const snapshotPath = arg(argv, 'snapshot');
  const apply = argv.includes('--apply');
  if (apply && arg(argv, 'confirm') !== 'staging') throw new Error('RECUSA: --apply exige --confirm=staging');
  if (!snapshotPath) throw new Error('--snapshot=<better-preview.json> é obrigatório');
  const today = arg(argv, 'today') ?? londonToday();
  const reportPath = arg(argv, 'report');

  const snapshot = parseBetterSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')));
  if (apply && !snapshot.fonte.feed_completo) throw new Error('RECUSA: snapshot com feed incompleto — repetir o preview');
  if (apply && snapshot.fonte.feed_url !== BETTER_CONFIG.feed_url) throw new Error('RECUSA: --apply só com snapshot do feed oficial (não offline)');
  const generatedPlan = planFromSeries(snapshot.series, today, snapshot.gerado_em, { snapshot_generated_at: snapshot.gerado_em, http_requests_in_this_run: 0 });

  // --sessions: ocorrências das sessões agendadas confirmadas (harvest completo).
  const sessionsPath = arg(argv, 'sessions');
  const sessions = sessionsPath ? parseSessionsState(JSON.parse(readFileSync(sessionsPath, 'utf8'))) : null;
  if (apply && sessions && !sessions.reached_end) throw new Error('RECUSA: --sessions com harvest incompleto (reached_end = false) — continuar o harvest antes do --apply');
  const useSessions = sessions !== null && sessions.reached_end;
  const plan = useSessions ? applyConfirmedSessions(generatedPlan, sessions, today) : generatedPlan;
  const sessionsReport = sessions === null ? null : {
    ficheiro: sessionsPath,
    reached_end: sessions.reached_end,
    paginas_lidas: sessions.pages_read_total,
    ocorrencias_de: useSessions ? 'sessões agendadas confirmadas (scheduled-sessions)' : 'eventSchedule (harvest incompleto: sessões NÃO usadas)',
    sessoes_futuras_confirmadas_por_serie: Object.fromEntries([...confirmedFutureBySeries(sessions, today)].map(([id, c]) => [`series:${id}`, { confirmadas: c.occurrences.length, canceladas: c.cancelled_future }])),
  };

  // Regra de inclusão do piloto (a mesma da curadoria, PR #66): só entra o
  // que tem sinal 60+ (confirmed_60plus / likely_suitable). Sessões gerais
  // para adultos/famílias (unclear) ficam fora, salvo --include-unclear.
  const includeUnclear = argv.includes('--include-unclear');
  const cls = (i: RawActivityItem) => (i.raw_payload['eligibility_proposal'] as { classification: string }).classification;
  const eligibleItems = includeUnclear ? plan.items : plan.items.filter(i => cls(i) === 'confirmed_60plus' || cls(i) === 'likely_suitable');
  const heldByRule = plan.items.filter(i => !eligibleItems.includes(i)).map(i => ({ source_item_id: i.source_item_id, titulo: i.title, motivo: 'sem sinal 60+ (regra de inclusão; usar --include-unclear para incluir)' }));
  const planned = eligibleItems.map(i => i.source_item_id);
  const db = apply ? await stagingDb() : null;
  let existing = new Set<string>();
  if (db) {
    await assertNoRunningRun(db, BETTER_CONFIG.source_key);
    const before = await stagedCountsBySeries(db, BETTER_CONFIG.source_key, BETTER_CONFIG.product_key, planned);
    existing = new Set([...before].filter(([, n]) => n > 0).map(([id]) => id));
  }
  const { insert, skip } = splitByExisting(eligibleItems, existing);

  const u3a = JSON.parse(readFileSync(new URL('../src/review-api/eligibility/richmond-u3a-60plus.v1.json', import.meta.url), 'utf8')) as U3aDataset;
  const dups = pilotDuplicates(plan.items, u3a);
  const recurrence = detectRecurrenceItems(insert);
  const byClass = plan.proposals.reduce<Record<string, number>>((m, p) => (m[p.classification] = (m[p.classification] ?? 0) + 1, m), {});

  let summary: unknown = null;
  if (apply && insert.length > 0) {
    const { reposForRun } = await import('../src/persistence/orchestration/reposForRun');
    const { IngestionOrchestrator } = await import('../src/persistence/orchestration/IngestionOrchestrator');
    const orchestrator = new IngestionOrchestrator(await reposForRun(false));
    const collector = { sourceKey: BETTER_CONFIG.source_key, collect: async () => ({ items: insert as RawActivityItem[], errors: [] }) };
    const sourceConfig: SourceConfigContract = { source_key: BETTER_CONFIG.source_key, product_key: BETTER_CONFIG.product_key };
    summary = await orchestrator.runActivityIngestion(collector, sourceConfig, { dryRun: false });
  }
  let duplicatedInStaging: string[] = [];
  if (db) {
    const after = await stagedCountsBySeries(db, BETTER_CONFIG.source_key, BETTER_CONFIG.product_key, planned);
    duplicatedInStaging = [...after].filter(([, n]) => n > 1).map(([id]) => id);
  }

  const report = {
    gerado_em: new Date().toISOString(),
    modo: apply ? 'ESCRITA EM STAGING' : 'DRY-RUN (sem escrita, sem cliente Supabase)',
    escrita_efetuada: summary !== null,
    linhas_gravadas: summary === null ? 0 : (summary as { stagedItems?: number }).stagedItems ?? null,
    hoje: today,
    snapshot: { ficheiro: snapshotPath, recolhido_em: snapshot.gerado_em, feed_completo: snapshot.fonte.feed_completo, pedidos_http_nesta_execucao: 0 },
    sessoes: sessionsReport,
    produto: BETTER_CONFIG.product_key,
    fonte: BETTER_CONFIG.source_key,
    licenca: BETTER_CONFIG.licence.attribution,
    contagens: {
      series_no_snapshot: snapshot.series.length,
      expiradas: plan.expired.length,
      fora_da_insercao: plan.held.length,
      fora_pela_regra_60plus: heldByRule.length,
      a_inserir: insert.length,
      ja_existentes_saltadas: skip.length,
      ocorrencias_a_inserir: insert.reduce((n, i) => n + i.occurrences.length, 0),
      proposta_elegibilidade: byClass,
      duplicados_u3a: dups.u3a.length,
      duplicados_fish: dups.fish.length,
    },
    linhas_previstas: {
      'public.sources (o script nunca escreve; seed separado)': 0,
      'staging.ingestion_runs': insert.length > 0 ? 1 : 0,
      'staging.raw_activity_items': insert.length,
      'staging.activities_staging (pending_review, venue unresolved)': insert.length,
      'staging.venues_staging': 0,
    },
    expiradas: plan.expired,
    fora_da_insercao: plan.held,
    fora_pela_regra_60plus: heldByRule,
    insercoes: recurrence.map(({ item, recurrence: r }) => ({
      source_item_id: item.source_item_id,
      titulo: item.title,
      datas: item.occurrences.map(o => o.date),
      horario: [...new Set(item.occurrences.map(o => `${o.time ?? 'sem hora'}${o.end_time ? `–${o.end_time}` : ''}`))],
      recorrencia_declarada: item.recurrence_text_hint,
      recorrencia_detectada: r,
      local: item.venue_mention ? `${item.venue_mention.raw_text} (${String(item.raw_payload['postcode'])})` : null,
      custo: item.price_text,
      url: item.external_url,
      elegibilidade: (item.raw_payload['eligibility_proposal'] as { classification: string }).classification,
    })),
    possiveis_duplicados: dups,
    resultado_escrita: summary,
    duplicados_em_staging_apos_escrita: duplicatedInStaging,
  };

  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(summary === null ? 'NADA FOI GRAVADO: a_inserir é uma previsão.' : `GRAVADO EM STAGING: ${report.linhas_gravadas} actividade(s).`);
  console.log(JSON.stringify({ modo: report.modo, escrita_efetuada: report.escrita_efetuada, contagens: report.contagens, linhas_previstas: report.linhas_previstas }, null, 2));
  if (reportPath) console.log(`Relatório: ${reportPath}`);
  if (duplicatedInStaging.length > 0) {
    throw new Error(`ERRO: séries duplicadas em activities_staging depois da escrita (execução concorrente?): ${duplicatedInStaging.join(', ')}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
}
