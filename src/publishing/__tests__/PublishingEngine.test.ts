/**
 * src/publishing/__tests__/PublishingEngine.test.ts
 * Sprint 8.6 — testes com mocks. Zero Supabase, zero rede.
 *
 * CORRECÇÃO (Level 2 review, PR #1) — acrescentados testes que faltavam
 * para a semântica real de falhas: a suíte original só testava o
 * publisher de negócio (venuePublisher/activityPublisher) a lançar,
 * nunca a própria infraestrutura de lifecycle/tracking (start/finish/
 * eventRepo.record/markFailed). Ver "PublishingEngine — semântica de
 * falhas de infraestrutura" no fim deste ficheiro.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublishingEngine } from '../services/PublishingEngine.js';
import type { VenuePublicationMetrics } from '../services/VenuePublisher.js';
import type { ActivityPublicationMetrics } from '../services/ActivityPublisher.js';
import type {
  IPublicationRunRepository,
  IPublicationEventRepository,
} from '../repositories/interfaces.js';
import type {
  PublicationRunId,
  PublicationEventId,
} from '../types/domain.js';

vi.mock('../../lib/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { logger } from '../../lib/logger.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RUN_ID       = 'run-001' as PublicationRunId;
const PRODUCT_KEY  = 'vivere-60-mais';
const TRIGGERED_BY = 'manual';
const STARTED      = new Date('2026-07-09T12:00:00.000Z');

function zeroVenueMetrics(overrides: Partial<VenuePublicationMetrics> = {}): VenuePublicationMetrics {
  return { venuesPublished: 0, venuesUpdated: 0, venuesSkipped: 0, venuesArchived: 0, errors: 0, durationMs: 0, ...overrides };
}

function zeroActivityMetrics(overrides: Partial<ActivityPublicationMetrics> = {}): ActivityPublicationMetrics {
  return { activitiesPublished: 0, activitiesUpdated: 0, activitiesSkipped: 0, activitiesArchived: 0, errors: 0, durationMs: 0, ...overrides };
}

function makeRunRepo(): IPublicationRunRepository {
  return {
    start:             vi.fn().mockResolvedValue(RUN_ID),
    finish:            vi.fn().mockResolvedValue(undefined),
    markFailed:        vi.fn().mockResolvedValue(undefined),
    findActive:        vi.fn().mockResolvedValue(null),
    findLastCompleted: vi.fn().mockResolvedValue(null),
  };
}

function makeEventRepo(): IPublicationEventRepository {
  return { record: vi.fn().mockResolvedValue('evt-001' as PublicationEventId) };
}

// ── Orquestração e ordem ──────────────────────────────────────────────────────

describe('PublishingEngine — orquestração', () => {
  it('publica venues antes de activities', async () => {
    const order: string[] = [];
    const venuePublisher    = { publish: vi.fn().mockImplementation(async () => { order.push('venues');     return zeroVenueMetrics(); }) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockImplementation(async () => { order.push('activities'); return zeroActivityMetrics(); }) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(order).toEqual(['venues', 'activities']);
  });

  it('cria a run via runRepo.start com productKey e triggeredBy', async () => {
    const venuePublisher    = { publish: vi.fn().mockResolvedValue(zeroVenueMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(runRepo.start).toHaveBeenCalledWith(PRODUCT_KEY, TRIGGERED_BY);
  });

  it('passa o mesmo runId a VenuePublisher e ActivityPublisher', async () => {
    const venuePublisher    = { publish: vi.fn().mockResolvedValue(zeroVenueMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(venuePublisher.publish).toHaveBeenCalledWith(PRODUCT_KEY, RUN_ID);
    expect(activityPublisher.publish).toHaveBeenCalledWith(PRODUCT_KEY, RUN_ID);
  });
});

// ── Agregação de métricas ──────────────────────────────────────────────────────

describe('PublishingEngine — métricas agregadas', () => {
  it('funde métricas de venues e activities num único PublicationRunMetrics', async () => {
    const venuePublisher = {
      publish: vi.fn().mockResolvedValue(zeroVenueMetrics({ venuesPublished: 3, venuesUpdated: 1, venuesSkipped: 2, venuesArchived: 1, errors: 0 })),
      preview: vi.fn().mockResolvedValue([]),
    };
    const activityPublisher = {
      publish: vi.fn().mockResolvedValue(zeroActivityMetrics({ activitiesPublished: 5, activitiesUpdated: 0, activitiesSkipped: 1, activitiesArchived: 0, errors: 0 })),
      preview: vi.fn().mockResolvedValue([]),
    };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(summary.metrics).toEqual({
      venuesPublished: 3, venuesUpdated: 1, venuesSkipped: 2, venuesArchived: 1,
      activitiesPublished: 5, activitiesUpdated: 0, activitiesSkipped: 1, activitiesArchived: 0,
      errors: 0, durationMs: 0,
    });
  });

  it('soma os errors de venues e activities', async () => {
    const venuePublisher    = { publish: vi.fn().mockResolvedValue(zeroVenueMetrics({ errors: 2 })) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics({ errors: 3 })) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(summary.metrics?.errors).toBe(5);
  });
});

// ── success / partial / failed ────────────────────────────────────────────────

describe('PublishingEngine — estados da run', () => {
  it('regista success quando errors = 0: finish() chamado, evento PublicationRunCompleted', async () => {
    const venuePublisher    = { publish: vi.fn().mockResolvedValue(zeroVenueMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(runRepo.finish).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({ errors: 0 }));
    expect(runRepo.markFailed).not.toHaveBeenCalled();
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'PublicationRunCompleted', entityId: RUN_ID }),
    );
    expect(summary.status).toBe('success');
  });

  it('regista partial quando errors > 0: finish() ainda é chamado (não markFailed)', async () => {
    const venuePublisher    = { publish: vi.fn().mockResolvedValue(zeroVenueMetrics({ errors: 1 })) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(runRepo.finish).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({ errors: 1 }));
    expect(runRepo.markFailed).not.toHaveBeenCalled();
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'PublicationRunCompleted', payload: expect.objectContaining({ status: 'partial' }) }),
    );
    expect(summary.status).toBe('partial');
  });

  it('regista failed quando venuePublisher.publish lança: markFailed() chamado, evento PublicationRunFailed, activityPublisher nunca chamado', async () => {
    const venuePublisher    = { publish: vi.fn().mockRejectedValue(new Error('falha catastrófica na leitura de staging')) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(runRepo.markFailed).toHaveBeenCalledWith(RUN_ID, 'falha catastrófica na leitura de staging');
    expect(runRepo.finish).not.toHaveBeenCalled();
    expect(activityPublisher.publish).not.toHaveBeenCalled();
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'PublicationRunFailed', entityId: RUN_ID }),
    );
    expect(summary.status).toBe('failed');
    expect(summary.metrics).toBeNull();
  });

  it('publish() nunca lança para falhas de negócio (publisher) — mesmo em falha catastrófica devolve um PublicationRunSummary', async () => {
    const venuePublisher    = { publish: vi.fn().mockRejectedValue(new Error('erro de rede')) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);

    await expect(engine.publish(PRODUCT_KEY, TRIGGERED_BY)).resolves.toMatchObject({ status: 'failed' });
  });

  it('regista failed quando activityPublisher.publish lança (após venues terem corrido)', async () => {
    const venuePublisher    = { publish: vi.fn().mockResolvedValue(zeroVenueMetrics({ venuesPublished: 2 })) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockRejectedValue(new Error('falha na leitura de activities')) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(venuePublisher.publish).toHaveBeenCalled(); // venues já correram
    expect(runRepo.markFailed).toHaveBeenCalledWith(RUN_ID, 'falha na leitura de activities');
    expect(summary.status).toBe('failed');
  });
});

// ── Não transforma nem persiste directamente ──────────────────────────────────

describe('PublishingEngine — não toma decisões de negócio', () => {
  it('summary devolvido reflecte exactamente runId, productKey e triggeredBy recebidos', async () => {
    const venuePublisher    = { publish: vi.fn().mockResolvedValue(zeroVenueMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(summary.runId).toBe(RUN_ID);
    expect(summary.productKey).toBe(PRODUCT_KEY);
    expect(summary.triggeredBy).toBe(TRIGGERED_BY);
  });
});

// ── preview() — Sprint 8.7 ────────────────────────────────────────────────────

describe('PublishingEngine.preview', () => {
  it('coordena preview de venues e activities, sem criar run nem eventos', async () => {
    const venueDecisions = [{ action: 'insert' as const, venue: {} as never, operational: {} as never }];
    const activityDecisions = [{ action: 'skip_expired' as const, activity: {} as never }];

    const venuePublisher    = { publish: vi.fn(), preview: vi.fn().mockResolvedValue(venueDecisions) };
    const activityPublisher = { publish: vi.fn(), preview: vi.fn().mockResolvedValue(activityDecisions) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const preview = await engine.preview(PRODUCT_KEY);

    expect(preview.venues).toEqual(venueDecisions);
    expect(preview.activities).toEqual(activityDecisions);
    expect(runRepo.start).not.toHaveBeenCalled();
    expect(eventRepo.record).not.toHaveBeenCalled();
  });
});

// ── Semântica de falhas de infraestrutura (Level 2 review, PR #1) ─────────────

describe('PublishingEngine — semântica de falhas de infraestrutura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propaga quando runRepo.start() falha — nenhuma run foi criada, nada a reportar como failed', async () => {
    const venuePublisher    = { publish: vi.fn(), preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn(), preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    (runRepo.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('RLS violation ao abrir run'));
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);

    await expect(engine.publish(PRODUCT_KEY, TRIGGERED_BY)).rejects.toThrow('RLS violation ao abrir run');
    expect(venuePublisher.publish).not.toHaveBeenCalled();
  });

  it('propaga quando runRepo.finish() falha no caminho de sucesso — publicação já aconteceu, esconder isso seria enganoso', async () => {
    const venuePublisher    = { publish: vi.fn().mockResolvedValue(zeroVenueMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    (runRepo.finish as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout ao gravar finish'));
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);

    await expect(engine.publish(PRODUCT_KEY, TRIGGERED_BY)).rejects.toThrow('timeout ao gravar finish');
  });

  it('propaga quando eventRepo.record() (Completed) falha no caminho de sucesso', async () => {
    const venuePublisher    = { publish: vi.fn().mockResolvedValue(zeroVenueMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();
    (eventRepo.record as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('falha ao registar evento'));

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);

    await expect(engine.publish(PRODUCT_KEY, TRIGGERED_BY)).rejects.toThrow('falha ao registar evento');
    expect(runRepo.finish).toHaveBeenCalled(); // finish() já tinha corrido com sucesso antes do evento falhar
  });

  it('preserva a causa original de negócio mesmo quando markFailed() também falha — não perde a excepção original silenciosamente', async () => {
    const venuePublisher    = { publish: vi.fn().mockRejectedValue(new Error('falha original de negócio')) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    (runRepo.markFailed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB indisponível ao marcar failed'));
    const eventRepo = makeEventRepo();

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    // handleFailure() não lança — a causa original continua a ser reportada
    expect(summary.status).toBe('failed');
    expect(summary.metrics).toBeNull();
    // a falha secundária (markFailed) fica registada via logger, não perdida, não silenciosa
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        originalReason: 'falha original de negócio',
        markFailedError: 'DB indisponível ao marcar failed',
      }),
      expect.any(String),
    );
    // o evento de falha ainda é tentado, apesar de markFailed ter falhado
    expect(eventRepo.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'PublicationRunFailed', payload: { reason: 'falha original de negócio' } }),
    );
  });

  it('preserva a causa original de negócio mesmo quando eventRepo.record() (Failed) também falha', async () => {
    const venuePublisher    = { publish: vi.fn().mockRejectedValue(new Error('falha original de negócio 2')) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    const eventRepo = makeEventRepo();
    (eventRepo.record as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('falha ao registar evento de falha'));

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(summary.status).toBe('failed');
    expect(runRepo.markFailed).toHaveBeenCalledWith(RUN_ID, 'falha original de negócio 2'); // markFailed ainda corre, apesar do evento falhar depois
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        originalReason: 'falha original de negócio 2',
        eventError: 'falha ao registar evento de falha',
      }),
      expect.any(String),
    );
  });

  it('quando markFailed() E eventRepo.record() falham ambos, a causa original ainda é devolvida e ambas as falhas secundárias ficam registadas', async () => {
    const venuePublisher    = { publish: vi.fn().mockRejectedValue(new Error('falha tripla')) , preview: vi.fn().mockResolvedValue([]) };
    const activityPublisher = { publish: vi.fn().mockResolvedValue(zeroActivityMetrics()) , preview: vi.fn().mockResolvedValue([]) };
    const runRepo   = makeRunRepo();
    (runRepo.markFailed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('markFailed indisponível'));
    const eventRepo = makeEventRepo();
    (eventRepo.record as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('evento indisponível'));

    const engine = new PublishingEngine(venuePublisher, activityPublisher, runRepo, eventRepo, () => STARTED);
    const summary = await engine.publish(PRODUCT_KEY, TRIGGERED_BY);

    expect(summary.status).toBe('failed');
    expect(summary.metrics).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
