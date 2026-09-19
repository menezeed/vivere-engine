/**
 * src/publishing/publish.ts
 *
 * Script de execução do Publishing Engine.
 *
 * Uso:
 *   npx tsx --env-file=.env src/publishing/publish.ts --product-key=vivere-60-mais --dry-run
 *   npx tsx --env-file=.env src/publishing/publish.ts --product-key=vivere-60-mais --preview
 *   npx tsx --env-file=.env src/publishing/publish.ts --product-key=vivere-60-mais
 *
 * --dry-run segue a mesma convenção de src/entity-resolution/run.ts: verifica
 * a configuração do ambiente e sai sem tocar em staging.* nem public.* — não
 * monta repositórios, não lê nada.
 *
 * --preview (Sprint 8.7): monta os repositórios REAIS e lê venues/activities
 * publicáveis de staging, aplica dirty check, PublicationTransformer e a
 * política de ocorrência futura (ADR-0020) — exactamente a mesma lógica de
 * decisão usada por publish() (VenuePublisher.preview()/ActivityPublisher.
 * preview(), que partilham os builders de decisão com publish() — zero risco
 * de o preview divergir do comportamento real). NUNCA executa insert, update,
 * archive, linkToStaging ou grava eventos. Não cria run em
 * public.publication_runs.
 *
 * Sem flags: publicação real.
 *
 * Fase 8: execução exclusivamente via CLI (Architecture Book v1.1 §15, Q3).
 */

import { PublishingRepositoryFactory } from './repositories/factory.js';
import { VenuePublisher }              from './services/VenuePublisher.js';
import { ActivityPublisher }           from './services/ActivityPublisher.js';
import { PublishingEngine }            from './services/PublishingEngine.js';
import { detectVenueDuplicates }       from './services/duplicateDetection.js';
import type { VenueDecision }          from './services/VenuePublisher.js';
import type { ActivityDecision }       from './services/ActivityPublisher.js';

const DRY_RUN     = process.argv.includes('--dry-run');
const PREVIEW     = process.argv.includes('--preview');
const PRODUCT_KEY = process.argv.find(a => a.startsWith('--product-key='))?.split('=')[1];

const SAMPLE_SIZE_PER_BUCKET = 5;

function log(msg: string, data?: unknown): void {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : PREVIEW ? '[PREVIEW] ' : '';
  console.log(`${prefix}${msg}`, data ? JSON.stringify(data, null, 2) : '');
}

// ── Formatação de amostra ──────────────────────────────────────────────────────

function formatVenueRow(d: VenueDecision): string {
  const publicId = 'publicVenueId' in d ? d.publicVenueId : '(ainda não existe)';
  const reason   = d.action === 'error' ? ` — motivo: ${d.reason}` : '';
  return `  [${d.action}] staging=${d.venue.stagingId} nome="${d.venue.name}" public=${publicId}${reason}`;
}

function describeActivityVenue(d: ActivityDecision, venueStagingIdsBeingInserted: ReadonlySet<string>): string {
  if (d.activity.resolvedPublicVenueId !== null) {
    return `venue_id=${d.activity.resolvedPublicVenueId}`;
  }
  if (d.activity.venueResolutionStatus === 'proposed_new') {
    return 'venue_id=NULL (proposed_new — venue novo, sem staging venue associado)';
  }
  // matched, mas sem promoted_venue_id ainda.
  const stagingVenueId = d.activity.resolvedVenueStagingId;
  if (stagingVenueId !== null && venueStagingIdsBeingInserted.has(stagingVenueId)) {
    return `venue_id=PENDING_PUBLICATION resolved_venue_staging_id=${stagingVenueId} (matched — resolve após VenuePublisher publicar esse venue nesta run)`;
  }
  // Anómalo: matched, mas o staging venue nem está entre os "insert" desta
  // run nem já foi publicado antes — possível venue rejeitado/removido
  // entretanto. Sinalizado, não escondido.
  return `venue_id=NULL ⚠ ANÓMALO — resolved_venue_staging_id=${stagingVenueId} não está entre os venues a publicar nesta run nem já publicado (venue rejeitado/removido?)`;
}

function formatActivityRow(d: ActivityDecision, venueStagingIdsBeingInserted: ReadonlySet<string>): string {
  const publicId = 'publicActivityId' in d ? d.publicActivityId : '(ainda não existe)';
  const venueInfo = describeActivityVenue(d, venueStagingIdsBeingInserted);

  let occurrenceInfo: string;
  if (d.action === 'insert' || d.action === 'update') {
    occurrenceInfo = `ocorrência seleccionada=${d.operational.start_date?.toISOString() ?? '(sem data)'}`;
  } else if (d.action === 'skip_expired' || d.action === 'archive_expired') {
    const dates = d.activity.occurrences.map(o => o.date).join(', ') || '(nenhuma)';
    occurrenceInfo = `sem ocorrência futura (datas em staging: ${dates})`;
  } else {
    occurrenceInfo = 'n/a';
  }

  const reason = d.action === 'error' ? ` — motivo: ${d.reason}` : '';

  return `  [${d.action}] staging=${d.activity.stagingId} título="${d.activity.title}" public=${publicId} ${venueInfo} ${occurrenceInfo}${reason}`;
}

function printSample<T extends { action: string }>(decisions: readonly T[], action: string, formatter: (d: T) => string): void {
  const matching = decisions.filter(d => d.action === action);
  if (matching.length === 0) return;

  console.log(`\n  -- ${action} (${matching.length}) --`);
  for (const d of matching.slice(0, SAMPLE_SIZE_PER_BUCKET)) {
    console.log(formatter(d));
  }
  if (matching.length > SAMPLE_SIZE_PER_BUCKET) {
    console.log(`  ... e mais ${matching.length - SAMPLE_SIZE_PER_BUCKET}`);
  }
}

// ── Modos ──────────────────────────────────────────────────────────────────────

async function runDryRun(): Promise<void> {
  log('Verificando configuração...');
  log('SUPABASE_URL',         process.env['SUPABASE_URL']         ? '✓' : '✗ ausente');
  log('SUPABASE_SERVICE_KEY', process.env['SUPABASE_SERVICE_KEY'] ? '✓' : '✗ ausente');
  log('');
  log('Dry-run concluído. Execute --preview para ver o plano de publicação com dados reais, ou sem flags para publicar.');
}

async function runPreview(productKey: string): Promise<void> {
  log(`Lendo dados reais para produto: ${productKey} (zero escrita)`);

  const repos = await PublishingRepositoryFactory.forSupabase();
  const venuePublisher    = new VenuePublisher(repos.publishableVenue, repos.publicVenue, repos.event);
  const activityPublisher = new ActivityPublisher(repos.publishableActivity, repos.publicActivity, repos.event);
  const engine             = new PublishingEngine(venuePublisher, activityPublisher, repos.run, repos.event);

  const { venues, activities } = await engine.preview(productKey);

  const venueCounts = {
    insert:         venues.filter(d => d.action === 'insert').length,
    update:         venues.filter(d => d.action === 'update').length,
    skip_not_dirty: venues.filter(d => d.action === 'skip_not_dirty').length,
    archive:        venues.filter(d => d.action === 'archive').length,
    error:          venues.filter(d => d.action === 'error').length,
  };

  const activityCounts = {
    insert:          activities.filter(d => d.action === 'insert').length,
    update:          activities.filter(d => d.action === 'update').length,
    skip_not_dirty:  activities.filter(d => d.action === 'skip_not_dirty').length,
    skip_expired:    activities.filter(d => d.action === 'skip_expired').length,
    archive_expired: activities.filter(d => d.action === 'archive_expired').length,
    error:           activities.filter(d => d.action === 'error').length,
  };

  // Sprint 8.7 (ponto 1 da revisão): três estados, não dois — resolvido,
  // pendente (matched, resolve após VenuePublisher nesta mesma run) e
  // proposed_new (nunca terá venue_id, por desenho).
  const venueStagingIdsBeingInserted = new Set(
    venues.filter(d => d.action === 'insert').map(d => d.venue.stagingId as string),
  );
  const withVenueResolved = activities.filter(d => d.activity.resolvedPublicVenueId !== null).length;
  const withVenuePending  = activities.filter(
    d => d.activity.resolvedPublicVenueId === null
      && d.activity.venueResolutionStatus === 'matched'
      && d.activity.resolvedVenueStagingId !== null
      && venueStagingIdsBeingInserted.has(d.activity.resolvedVenueStagingId),
  ).length;
  const withVenueProposedNew = activities.filter(d => d.activity.venueResolutionStatus === 'proposed_new').length;
  const withVenueAnomalous = activities.length - withVenueResolved - withVenuePending - withVenueProposedNew;

  console.log('\n=== Preview — plano de publicação (zero escrita) ===');
  console.log(`\nVenues (total lido: ${venues.length}):`);
  console.log(`  novos:              ${venueCounts.insert}`);
  console.log(`  dirty para update:  ${venueCounts.update}`);
  console.log(`  não-dirty:          ${venueCounts.skip_not_dirty}`);
  console.log(`  para arquivar:      ${venueCounts.archive}`);
  if (venueCounts.error > 0) console.log(`  ⚠ erros:            ${venueCounts.error}`);

  console.log(`\nActivities (total lido: ${activities.length}):`);
  console.log(`  novas:                       ${activityCounts.insert}`);
  console.log(`  dirty para update:           ${activityCounts.update}`);
  console.log(`  não-dirty:                   ${activityCounts.skip_not_dirty}`);
  console.log(`  expiradas para skip:         ${activityCounts.skip_expired}`);
  console.log(`  expiradas para archive:      ${activityCounts.archive_expired}`);
  console.log(`  com venue já resolvido:      ${withVenueResolved}`);
  console.log(`  com venue pendente (matched, resolve nesta run): ${withVenuePending}`);
  console.log(`  proposed_new (venue_id sempre NULL, por desenho): ${withVenueProposedNew}`);
  if (withVenueAnomalous > 0) console.log(`  ⚠ anómalas (matched, venue não encontrado): ${withVenueAnomalous}`);
  if (activityCounts.error > 0) console.log(`  ⚠ erros:                     ${activityCounts.error}`);

  // Sprint 8.7 (ponto 3/5 da revisão): funil real, com números da base de
  // dados — não apenas os critérios em texto. describeFunnel() é um método
  // aditivo, puramente informativo (nunca usado por findUnpublished/findDirty).
  const funnel = await repos.publishableActivity.describeFunnel(productKey);
  const eligibleStatuses = ['matched', 'proposed_new'] as const;
  const excludedTotal = funnel.total - eligibleStatuses.reduce((sum, s) => sum + (funnel.byVenueResolutionStatus[s] ?? 0), 0);

  console.log('\n=== Funil de elegibilidade — activities_staging ===');
  console.log(`  total em activities_staging: ${funnel.total}`);
  for (const [status, count] of Object.entries(funnel.byVenueResolutionStatus).sort((a, b) => b[1] - a[1])) {
    const eligible = (eligibleStatuses as readonly string[]).includes(status);
    console.log(`    ${status}: ${count}${eligible ? ' (elegível para publicação)' : ' (excluída — fora do critério de publicação)'}`);
  }
  console.log(`  já publicadas (promoted_activity_id preenchido, dentro dos estados elegíveis): ${funnel.alreadyPublished}`);
  console.log(`  excluídas (fora de matched/proposed_new): ${excludedTotal}`);
  console.log(`  elegíveis para esta run (lidas por findUnpublished + findDirty): ${activities.length}`);
  console.log('\n  Critério exacto da query (PublishableActivityRepository):');
  console.log('    WHERE product_key = <productKey>');
  console.log("      AND venue_resolution_status IN ('matched', 'proposed_new')");
  console.log('      AND promoted_activity_id IS NULL   -- (findUnpublished) | IS NOT NULL (findDirty)');
  console.log('  Decisão oficial (confirmada): proposal_status de activities NÃO participa deste');
  console.log('  gate na Fase 8 — o gate é venue_resolution_status + decisão humana já registada');
  console.log('  em venue_resolution_decisions. Ver pendência de documentação para Architecture Book v1.2.');

  // Sprint 8.7 (ponto 2 da revisão): relatório de possíveis venues
  // duplicados entre os candidatos a insert — nunca dedupe automático.
  const insertVenues = venues
    .filter((d): d is Extract<VenueDecision, { action: 'insert' }> => d.action === 'insert')
    .map(d => ({
      stagingId: d.venue.stagingId as string,
      name:      d.venue.name,
      city:      d.venue.city,
      lat:       d.venue.lat,
      lng:       d.venue.lng,
    }));
  const duplicateGroups = detectVenueDuplicates(insertVenues);

  console.log(`\n=== Possíveis venues duplicados entre os ${insertVenues.length} novos (revisão humana) ===`);
  if (duplicateGroups.length === 0) {
    console.log('  Nenhum nome normalizado repetido encontrado.');
  } else {
    for (const group of duplicateGroups) {
      const distance = group.maxDistanceMeters !== null
        ? `${group.maxDistanceMeters.toFixed(0)}m entre os mais afastados`
        : 'distância desconhecida (falta lat/lng nalgum membro)';
      console.log(`\n  "${group.normalizedName}" — ${group.members.length} candidatos, ${distance}:`);
      for (const member of group.members) {
        console.log(`    staging=${member.stagingId} nome="${member.name}" cidade=${member.city ?? '(sem cidade)'} lat=${member.lat ?? '?'} lng=${member.lng ?? '?'}`);
      }
    }
    console.log('\n  ⚠ Nenhuma acção automática foi tomada — revisar manualmente antes de publicar.');
  }

  console.log('\n=== Amostra — venues ===');
  printSample(venues, 'insert', formatVenueRow);
  printSample(venues, 'update', formatVenueRow);
  printSample(venues, 'skip_not_dirty', formatVenueRow);
  printSample(venues, 'archive', formatVenueRow);
  printSample(venues, 'error', formatVenueRow);

  console.log('\n=== Amostra — activities ===');
  const formatActivity = (d: ActivityDecision): string => formatActivityRow(d, venueStagingIdsBeingInserted);
  printSample(activities, 'insert', formatActivity);
  printSample(activities, 'update', formatActivity);
  printSample(activities, 'skip_not_dirty', formatActivity);
  printSample(activities, 'skip_expired', formatActivity);
  printSample(activities, 'archive_expired', formatActivity);
  printSample(activities, 'error', formatActivity);

  console.log('\nPreview concluído. Nenhuma escrita foi feita. Execute sem flags para publicar de facto.');
}

async function runReal(productKey: string): Promise<void> {
  const repos = await PublishingRepositoryFactory.forSupabase();

  const venuePublisher    = new VenuePublisher(repos.publishableVenue, repos.publicVenue, repos.event);
  const activityPublisher = new ActivityPublisher(repos.publishableActivity, repos.publicActivity, repos.event);
  const engine             = new PublishingEngine(venuePublisher, activityPublisher, repos.run, repos.event);

  log(`Iniciando publicação para produto: ${productKey}`);
  const summary = await engine.publish(productKey, 'manual');

  console.log('\n=== Resultado da Run ===');
  console.log(`  Run ID:     ${summary.runId}`);
  console.log(`  Status:     ${summary.status}`);
  console.log(`  Duration:   ${summary.metrics?.durationMs ?? 0}ms`);

  if (summary.metrics) {
    console.log('\n  Venues:');
    console.log(`    Published: ${summary.metrics.venuesPublished}`);
    console.log(`    Updated:   ${summary.metrics.venuesUpdated}`);
    console.log(`    Skipped:   ${summary.metrics.venuesSkipped}`);
    console.log(`    Archived:  ${summary.metrics.venuesArchived}`);
    console.log('\n  Activities:');
    console.log(`    Published: ${summary.metrics.activitiesPublished}`);
    console.log(`    Updated:   ${summary.metrics.activitiesUpdated}`);
    console.log(`    Skipped:   ${summary.metrics.activitiesSkipped}`);
    console.log(`    Archived:  ${summary.metrics.activitiesArchived}`);
    console.log(`\n  Errors:     ${summary.metrics.errors}`);
  }

  if (summary.status === 'failed') {
    console.error('\n✗ A run falhou. Verificar logs e public.publication_runs.');
    process.exit(1);
  }

  if (summary.status === 'partial') {
    console.warn('\n⚠ A run concluiu com erros parciais. Verificar métricas acima.');
    process.exit(1);
  }

  console.log('\n✔ Publishing Engine concluído com sucesso.');
}

async function main(): Promise<void> {
  console.log('=== Vivere Platform — Publishing Engine ===');
  console.log(`Modo:        ${DRY_RUN ? 'DRY-RUN (config apenas)' : PREVIEW ? 'PREVIEW (leitura real, zero escrita)' : 'REAL'}`);
  console.log(`Product key: ${PRODUCT_KEY ?? '(não especificado)'}`);
  console.log('');

  if (DRY_RUN) {
    await runDryRun();
    return;
  }

  if (!PRODUCT_KEY) {
    console.error('Erro: especifique --product-key');
    console.error('  Exemplo: npx tsx src/publishing/publish.ts --product-key=vivere-60-mais --preview');
    process.exit(1);
  }

  if (PREVIEW) {
    await runPreview(PRODUCT_KEY);
    return;
  }

  await runReal(PRODUCT_KEY);
}

main().catch(err => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
