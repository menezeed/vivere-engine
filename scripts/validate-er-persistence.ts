/**
 * scripts/validate-er-persistence.ts
 *
 * Script de validação da Sprint 7.4 — camada de persistência ER.
 *
 * PROPÓSITO (ajuste #7 do roadmap):
 * Validar toda a camada de repositórios ER isoladamente,
 * sem nenhum algoritmo, matcher ou motor de resolução.
 *
 * O script verifica:
 *   1. Criar uma run de resolução
 *   2. Inserir candidatos sintéticos
 *   3. Consultar esses candidatos
 *   4. Remover candidatos de uma actividade
 *   5. Finalizar a run
 *
 * Executar APÓS aplicar migrations 0008–0010 em produção:
 *   npx tsx --env-file=.env scripts/validate-er-persistence.ts
 *
 * Flags:
 *   --dry-run   Executa sem escrever no banco (verifica configuração)
 *   --cleanup   Remove os dados de teste após validação
 */

import { EntityResolutionRepositoryFactory } from '../src/entity-resolution/repositories/factory.js';
import type {
  ActivityStagingId,
  VenueStagingId,
  ResolutionRunId,
  CandidateId,
} from '../src/entity-resolution/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const CLEANUP  = process.argv.includes('--cleanup');

// ── Dados sintéticos de teste ─────────────────────────────────────────────────

// UUIDs fictícios — não precisam de existir no banco para este script
// (os repositórios concretos devem aceitar UUIDs externos nas FK nullable)
const SYNTHETIC_ACTIVITY_ID = '00000000-0000-0000-0000-000000000001' as ActivityStagingId;
const SYNTHETIC_VENUE_ID    = '00000000-0000-0000-0000-000000000002' as VenueStagingId;
const PRODUCT_KEY           = 'vivere-60-mais';

// ── Utilitários ───────────────────────────────────────────────────────────────

function log(step: string, detail?: unknown): void {
  const prefix = DRY_RUN ? '[DRY-RUN] ' : '';
  console.log(`${prefix}✔ ${step}`, detail ?? '');
}

function fail(step: string, error: unknown): never {
  console.error(`✘ ${step}:`, error);
  process.exit(1);
}

// ── Script principal ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Vivere Platform — Validação da Persistência ER ===');
  console.log(`Produto: ${PRODUCT_KEY}`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (sem escrita)' : 'REAL'}`);
  console.log(`Cleanup: ${CLEANUP ? 'sim' : 'não'}`);
  console.log('');

  if (DRY_RUN) {
    log('Modo dry-run — verificando apenas configuração');
    log('SUPABASE_URL', process.env['SUPABASE_URL'] ? '✓ definido' : '✗ ausente');
    log('SUPABASE_SERVICE_KEY', process.env['SUPABASE_SERVICE_KEY'] ? '✓ definido' : '✗ ausente');
    console.log('\nDry-run concluído. Execute sem --dry-run para validar a persistência real.');
    return;
  }

  // ── Montar repositórios ────────────────────────────────────────────────────
  let repos: Awaited<ReturnType<typeof EntityResolutionRepositoryFactory.forSupabase>>;
  try {
    repos = await EntityResolutionRepositoryFactory.forSupabase();
    log('Repositórios montados via EntityResolutionRepositoryFactory.forSupabase()');
  } catch (e) {
    fail('EntityResolutionRepositoryFactory.forSupabase()', e);
  }

  let runId: ResolutionRunId;
  let candidateIds: CandidateId[];

  // ── Passo 1: Criar uma run ─────────────────────────────────────────────────
  try {
    runId = await repos.run.start(PRODUCT_KEY, 'validate-er-persistence-script');
    log('Passo 1 — Run criada', { runId });
  } catch (e) {
    fail('Passo 1 — repos.run.start()', e);
  }

  // ── Passo 2: Verificar que não existe run activa duplicada ─────────────────
  try {
    const active = await repos.run.findActive(PRODUCT_KEY);
    if (!active || active.runId !== runId) {
      fail('Passo 2 — findActive()', `Run activa não encontrada ou ID diferente: ${active?.runId}`);
    }
    log('Passo 2 — findActive() retorna a run correcta', { runId: active.runId, status: active.status });
  } catch (e) {
    fail('Passo 2 — repos.run.findActive()', e);
  }

  // ── Passo 3: Inserir candidatos sintéticos ────────────────────────────────
  try {
    const syntheticCandidates = [
      {
        candidate: {
          id:                   SYNTHETIC_VENUE_ID,
          product_key:          PRODUCT_KEY,
          name:                 'Venue Sintético de Teste',
          address:              'Rua do Teste, 123, Cabo Frio - RJ',
          city:                 'Cabo Frio RJ',
          lat:                  -22.879,
          lng:                  -42.019,
          google_types:         ['point_of_interest'],
          source_category_hint: 'teste',
          proposal_status:      'approved' as const,
        },
        score: {
          candidateId:   SYNTHETIC_VENUE_ID,
          nameScore:     { value: 0.80, method: 'name' as const, detail: 'contains match', subMethod: 'contains' },
          geoScore:      { value: 0.85, method: 'geo'  as const, detail: 'distance: 200m' },
          addressScore:  null,
          hybridScore:   0.823,
          finalScore:    0.923,
          boostApplied:  0.10,
        },
        rank:               1,
        autoClassification: 'matched' as const,
      },
    ];

    candidateIds = await repos.candidate.insertCandidates(
      runId,
      SYNTHETIC_ACTIVITY_ID,
      PRODUCT_KEY,
      syntheticCandidates,
    );
    log('Passo 3 — Candidatos inseridos', { count: candidateIds.length, ids: candidateIds });
  } catch (e) {
    fail('Passo 3 — repos.candidate.insertCandidates()', e);
  }

  // ── Passo 4: Consultar candidatos ─────────────────────────────────────────
  try {
    const found = await repos.candidate.findByActivity(SYNTHETIC_ACTIVITY_ID);
    if (found.length !== 1) {
      fail('Passo 4 — findByActivity()', `Esperado 1 candidato, encontrado ${found.length}`);
    }
    if (found[0]!.score < 0.9) {
      fail('Passo 4 — score', `Esperado ≥ 0.9, encontrado ${found[0]!.score}`);
    }
    log('Passo 4 — Candidatos consultados', { count: found.length, score: found[0]!.score });
  } catch (e) {
    fail('Passo 4 — repos.candidate.findByActivity()', e);
  }

  // ── Passo 5: findEligibleVenues (read-only em venues_staging) ─────────────
  try {
    const eligible = await repos.candidate.findEligibleVenues(PRODUCT_KEY, ['approved', 'promoted']);
    log('Passo 5 — findEligibleVenues()', { count: eligible.length, productKey: PRODUCT_KEY });
    if (eligible.length === 0) {
      console.warn('  ⚠ Nenhum venue approved/promoted encontrado. O pool está vazio.');
      console.warn('  ⚠ Aprovar venues no Admin Panel antes de executar o motor.');
    }
  } catch (e) {
    fail('Passo 5 — repos.candidate.findEligibleVenues()', e);
  }

  // ── Passo 6: Remover candidatos de uma actividade ─────────────────────────
  if (CLEANUP) {
    try {
      const deleted = await repos.candidate.deleteByActivity(SYNTHETIC_ACTIVITY_ID);
      log('Passo 6 — Candidatos removidos (cleanup)', { deleted });
    } catch (e) {
      fail('Passo 6 — repos.candidate.deleteByActivity()', e);
    }
  } else {
    log('Passo 6 — Remoção de candidatos ignorada (sem --cleanup)');
  }

  // ── Passo 7: Finalizar a run ──────────────────────────────────────────────
  try {
    await repos.run.finish(runId, { activitiesProcessed: 1, candidatesGenerated: 1 });
    log('Passo 7 — Run finalizada com sucesso', { runId });
  } catch (e) {
    fail('Passo 7 — repos.run.finish()', e);
  }

  // ── Passo 8: Verificar que run já não está activa ─────────────────────────
  try {
    const active = await repos.run.findActive(PRODUCT_KEY);
    if (active !== null) {
      fail('Passo 8 — findActive() após finish()', `Run ainda activa após finish(): ${active.runId}`);
    }
    log('Passo 8 — findActive() correctamente retorna null após finish()');
  } catch (e) {
    fail('Passo 8 — repos.run.findActive() após finish()', e);
  }

  // ── Resultado final ───────────────────────────────────────────────────────
  console.log('');
  console.log('=== Validação concluída com sucesso ===');
  console.log('A camada de persistência ER está operacional.');
  console.log('');
  console.log('Próximo passo: implementar NameMatcher (Sprint 7.5).');

  if (!CLEANUP) {
    console.log('');
    console.log(`Dados de teste deixados no banco (run ${runId}).`);
    console.log('Execute com --cleanup para remover.');
  }
}

main().catch(e => {
  console.error('Erro inesperado:', e);
  process.exit(1);
});
