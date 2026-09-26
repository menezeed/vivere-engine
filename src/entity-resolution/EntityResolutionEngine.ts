/**
 * entity-resolution/EntityResolutionEngine.ts
 *
 * Implementação do IEntityResolutionEngine — orquestrador do pipeline completo.
 *
 * Level 2, 2026-09-26 — territorialContextProvider injectado (último
 * parâmetro do construtor, com default NULL_TERRITORIAL_CONTEXT_PROVIDER
 * — preserva compatibilidade posicional com chamadores existentes que
 * não o passam explicitamente). Resolve trustedCityContext a partir de
 * activity.source_key antes de runPipeline() — nunca importa nenhuma
 * config concreta de collector (CABO_FRIO_CONFIG, etc.) directamente.
 */

import type { IEntityResolutionEngine, IMatcher } from './interfaces/index.js';
import type { IEntityResolutionRepositorySet } from './repositories/interfaces.js';
import type { ActivityResolutionRepository } from './repositories/impl/ActivityResolutionRepository.js';
import type { IERLogger } from './utils/logging.js';
import type { ISourceTerritorialContextProvider } from './interfaces/providers.js';
import type {
  ActivityStagingId,
  VenueStagingId,
  ResolutionRunId,
  ResolutionResult,
  ScoredCandidates,
  AutoClassification,
  RankedCandidate,
  TrustedCityContext,
} from './types/domain.js';
import type { ERResult, BatchERResult } from './types/result.js';
import type { EntityResolutionConfig } from './config/index.js';

import { CandidateGenerator }    from './pipeline/CandidateGenerator.js';
import { CandidatePreFilter }    from './pipeline/CandidatePreFilter.js';
import { HybridScoreCalculator } from './pipeline/HybridScoreCalculator.js';
import { ThresholdClassifier, buildCandidateMap } from './pipeline/ThresholdClassifier.js';
import { VenueCandidateProvider } from './pipeline/VenueCandidateProvider.js';
import { DEFAULT_ER_CONFIG }     from './config/index.js';
import { NULL_TERRITORIAL_CONTEXT_PROVIDER } from './interfaces/providers.js';
import { success, partial, unresolved, failed } from './types/result.js';
import { ERSilentLogger, startTimer } from './utils/logging.js';
import type { PipelineMetrics, OperationalMetrics, BusinessMetrics } from './utils/logging.js';

export class EntityResolutionEngine implements IEntityResolutionEngine {
  private readonly preFilter  = new CandidatePreFilter();
  private readonly calculator = new HybridScoreCalculator();
  private readonly classifier = new ThresholdClassifier();

  constructor(
    private readonly repos:        IEntityResolutionRepositorySet,
    private readonly activityRepo: ActivityResolutionRepository,
    private readonly matchers:     readonly IMatcher[],
    private readonly logger:       IERLogger = ERSilentLogger,
    private readonly defaultConfig: EntityResolutionConfig = DEFAULT_ER_CONFIG,
    private readonly territorialContextProvider: ISourceTerritorialContextProvider = NULL_TERRITORIAL_CONTEXT_PROVIDER,
  ) {}

  // ── resolve() — cria a sua própria run ──────────────────────────────────

  async resolve(
    activityId:      ActivityStagingId,
    configOverride?: Partial<EntityResolutionConfig>,
  ): Promise<ERResult> {
    const config = this.mergeConfig(configOverride);
    const totalTimer = startTimer();

    let runId: ResolutionRunId | null = null;

    try {
      // 1. Ler actividade
      const activity = await this.activityRepo.findById(activityId);
      if (!activity) {
        return failed({ code: 'ACTIVITY_NOT_FOUND', message: `Actividade não encontrada: ${activityId}`, context: { activityId } } as any);
      }

      // 2. Verificar decisão humana existente (ADR-0013)
      const existingDecision = await this.repos.decision.findLatest(activityId);
      if (existingDecision && existingDecision.action !== 'skipped') {
        this.logger.activitySkipped(activityId, 'no-run', `Decisão existente: ${existingDecision.action}`);
        return unresolved(this.buildEmptyResult(activityId, 'no-run' as ResolutionRunId, 0), 'no_venue_mention');
      }

      // 3. Sem VenueMention → não há nada a resolver
      if (!activity.venue_mention) {
        this.logger.activityNoMention(activityId, 'no-run');
        return unresolved(this.buildEmptyResult(activityId, 'no-run' as ResolutionRunId, totalTimer.stop()), 'no_venue_mention');
      }

      // 4. Criar run própria para este resolve() isolado
      runId = await this.repos.run.start(activity.product_key, 'resolve-single');

      // 5. Limpar candidatos anteriores sem decisão (ADR-0013)
      await this.repos.candidate.deleteByActivity(activityId);

      // 6. Resolver contexto territorial confiável (Level 2, 2026-09-26)
      const trustedCityContext = this.territorialContextProvider.getCityContext(activity.source_key ?? '');

      // 7. Executar pipeline
      const result = await this.runPipeline(
        activityId, activity.venue_mention, activity.product_key, runId, config, trustedCityContext,
      );

      // 8. Finalizar run
      await this.repos.run.finish(runId, {
        activitiesProcessed: 1,
        candidatesGenerated: result.resolutionResult.allCandidates.length,
      });

      const totalMs = totalTimer.stop();
      this.logger.activityResolved(result.metrics);

      const { resolutionResult, erResult } = result;
      return erResult;

    } catch (err) {
      if (runId) await this.repos.run.markFailed(runId, String(err)).catch(() => {});
      this.logger.activityFailed(activityId, runId ?? 'no-run', err);
      return failed({ code: 'CANDIDATE_GENERATION_ERROR', message: String(err), context: {} } as any);
    }
  }

  // ── resolveAll() ─────────────────────────────────────────────────────

  async resolveAll(
    productKey:      string,
    configOverride?: Partial<EntityResolutionConfig>,
  ): Promise<BatchERResult> {
    const config = this.mergeConfig(configOverride);
    const totalTimer = startTimer();

    // Verificar run activa e limpar se for órfã
    const activeRun = await this.repos.run.findActive(productKey);
    if (activeRun) {
      await this.repos.run.markFailed(activeRun.runId, 'Run órfã detectada — marcada como failed pelo resolveAll');
      this.logger.runFailed(activeRun.runId, productKey, 'Run órfã limpa automaticamente');
    }

    const runId = await this.repos.run.start(productKey, 'resolveAll');
    this.logger.runStarted(runId, productKey, 0);

    try {
      const activities = await this.activityRepo.findUnresolved(productKey);
      this.logger.runStarted(runId, productKey, activities.length);

      const results: ERResult[] = [];
      let candidatesGenerated = 0;

      for (const activity of activities) {
        this.logger.activityStarted(activity.id, runId, activity.venue_mention?.raw_text ?? null);
        const result = await this.resolveForRun(activity.id, runId, activity.product_key, config);
        results.push(result);
        if (result.kind !== 'failed' && (result as any).result) {
          candidatesGenerated += (result as any).result.allCandidates.length;
        }
      }

      await this.repos.run.finish(runId, { activitiesProcessed: activities.length, candidatesGenerated });

      const summary = this.buildSummary(results);
      this.logger.runFinished(runId, productKey, { ...summary, totalMs: totalTimer.stop() });

      return { runId, results, summary: { ...summary, durationMs: totalTimer.stop() } };

    } catch (err) {
      await this.repos.run.markFailed(runId, String(err));
      this.logger.runFailed(runId, productKey, String(err));
      return this.emptyBatchResult(runId, totalTimer.stop());
    }
  }

  // ── resolveMany() ─────────────────────────────────────────────────────

  async resolveMany(
    activityIds:     readonly ActivityStagingId[],
    configOverride?: Partial<EntityResolutionConfig>,
  ): Promise<BatchERResult> {
    const totalTimer = startTimer();
    const results: ERResult[] = [];
    for (const id of activityIds) {
      results.push(await this.resolve(id, configOverride));
    }
    const summary = this.buildSummary(results);
    return { runId: '', results, summary: { ...summary, durationMs: totalTimer.stop() } };
  }

  // ── Pipeline reutilizável ────────────────────────────────────────────

  private async runPipeline(
    activityId:         ActivityStagingId,
    mention:            NonNullable<Awaited<ReturnType<ActivityResolutionRepository['findById']>>>['venue_mention'] & {},
    productKey:         string,
    runId:               ResolutionRunId,
    config:              EntityResolutionConfig,
    trustedCityContext:  TrustedCityContext | null,
  ) {
    const timer = startTimer();

    const provider  = new VenueCandidateProvider(this.repos.candidate);
    const generator = new CandidateGenerator(provider);

    const genTimer = startTimer();
    const pool = await generator.generate(activityId, mention, productKey, config.selection, trustedCityContext);
    const generatorMs = genTimer.stop();

    const preFilterTimer = startTimer();
    const filtered = this.preFilter.filter(pool, config.selection);
    const preFilterMs = preFilterTimer.stop();

    if (filtered.candidates.length === 0) {
      await this.activityRepo.updateResolutionStatus(activityId, 'proposed_new', null, null);
      const emptyResult = this.buildEmptyResult(activityId, runId, timer.stop());
      const emptyWithClass = { ...emptyResult, classification: 'proposed_new' as AutoClassification };
      return {
        resolutionResult: emptyWithClass,
        erResult: unresolved(emptyWithClass, 'prefilter_eliminated_all' as const),
        metrics: this.buildMetrics(activityId, productKey, runId, pool.candidates.length, 0, generatorMs, preFilterMs, 0, timer.stop(), { activityId, venueMention: mention, scores: [] }, 'proposed_new', null),
      };
    }

    const hybridTimer = startTimer();
    const scored   = this.calculator.calculate(filtered, this.matchers, config.scoring);
    const hybridMs = hybridTimer.stop();

    const map    = buildCandidateMap(filtered.candidates);
    const ranked = this.classifier.classifyWithCandidates(scored, config.thresholds, map);

    await this.repos.candidate.insertCandidates(runId, activityId, productKey, ranked.ranked);

    const top = ranked.ranked[0] ?? null;
    const resolvedId = (ranked.classification === 'matched' && top)
      ? top.candidate.id as VenueStagingId : null;
    await this.activityRepo.updateResolutionStatus(activityId, ranked.classification, resolvedId, top?.score.finalScore ?? null);

    const totalMs = timer.stop();
    const resolutionResult: ResolutionResult = {
      activityId, venueMention: mention,
      classification: ranked.classification, topCandidate: top,
      allCandidates: ranked.ranked, candidatesInPool: pool.candidates.length,
      candidatesFiltered: filtered.candidates.length, processingMs: totalMs, runId,
    };

    const metrics = this.buildMetrics(activityId, productKey, runId, pool.candidates.length, filtered.candidates.length, generatorMs, preFilterMs, hybridMs, totalMs, scored, ranked.classification, top);

    let erResult: ERResult;
    if (ranked.classification === 'matched')   erResult = success(resolutionResult);
    else if (ranked.classification === 'ambiguous') erResult = partial(resolutionResult, ['Múltiplos candidatos com alta confiança']);
    else erResult = unresolved(resolutionResult, 'all_below_threshold');

    return { resolutionResult, erResult, metrics };
  }

  private async resolveForRun(
    activityId: ActivityStagingId,
    runId:      ResolutionRunId,
    productKey: string,
    config:     EntityResolutionConfig,
  ): Promise<ERResult> {
    try {
      const activity = await this.activityRepo.findById(activityId);
      if (!activity) return failed({ code: 'ACTIVITY_NOT_FOUND', message: activityId, context: {} } as any);

      const existingDecision = await this.repos.decision.findLatest(activityId);
      if (existingDecision && existingDecision.action !== 'skipped') {
        this.logger.activitySkipped(activityId, runId, existingDecision.action);
        return unresolved(this.buildEmptyResult(activityId, runId, 0), 'no_venue_mention');
      }

      if (!activity.venue_mention) {
        this.logger.activityNoMention(activityId, runId);
        return unresolved(this.buildEmptyResult(activityId, runId, 0), 'no_venue_mention');
      }

      await this.repos.candidate.deleteByActivity(activityId);
      const trustedCityContext = this.territorialContextProvider.getCityContext(activity.source_key ?? '');
      const result = await this.runPipeline(activityId, activity.venue_mention, productKey, runId, config, trustedCityContext);
      this.logger.activityResolved(result.metrics);
      return result.erResult;

    } catch (err) {
      this.logger.activityFailed(activityId, runId, err);
      return failed({ code: 'CANDIDATE_GENERATION_ERROR', message: String(err), context: {} } as any);
    }
  }

  // ── Utilitários ─────────────────────────────────────────────────────

  private mergeConfig(override?: Partial<EntityResolutionConfig>): EntityResolutionConfig {
    if (!override) return this.defaultConfig;
    return {
      selection:  override.selection  ?? this.defaultConfig.selection,
      scoring:    override.scoring    ?? this.defaultConfig.scoring,
      thresholds: override.thresholds ?? this.defaultConfig.thresholds,
    };
  }

  private buildEmptyResult(activityId: ActivityStagingId, runId: ResolutionRunId, processingMs: number): ResolutionResult {
    return {
      activityId, venueMention: null, classification: 'proposed_new',
      topCandidate: null, allCandidates: [],
      candidatesInPool: 0, candidatesFiltered: 0, processingMs, runId,
    };
  }

  private buildSummary(results: ERResult[]) {
    let succeeded = 0, partial_ = 0, unresolved_ = 0, failed_ = 0;
    for (const r of results) {
      if (r.kind === 'success')         succeeded++;
      else if (r.kind === 'partial')    partial_++;
      else if (r.kind === 'unresolved') unresolved_++;
      else failed_++;
    }
    return {
      total: results.length, succeeded, partial: partial_,
      unresolved: unresolved_, failed: failed_,
      activitiesProcessed: results.length,
      matched: succeeded, ambiguous: partial_, proposed_new: unresolved_,
    };
  }

  private emptyBatchResult(runId: string, durationMs: number): BatchERResult {
    return { runId, results: [], summary: { total: 0, succeeded: 0, partial: 0, unresolved: 0, failed: 0, durationMs } };
  }

  private buildMetrics(
    activityId: string, productKey: string, runId: string,
    candidatesGenerated: number, candidatesFiltered: number,
    generatorMs: number, preFilterMs: number, hybridMs: number, totalMs: number,
    scored: ScoredCandidates,
    classification: AutoClassification,
    top: RankedCandidate | null,
  ): PipelineMetrics {
    const scores = scored.scores.map(s => s.finalScore);
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;

    const op: OperationalMetrics = {
      activityId, productKey, runId,
      candidatesGenerated, candidatesFiltered, candidatesScored: scores.length,
      generatorMs, preFilterMs, nameMatcherMs: 0, geoMatcherMs: 0,
      addressMatcherMs: 0, hybridMs, classifierMs: 0, persistenceMs: 0, totalMs,
    };
    const biz: BusinessMetrics = {
      activityId, productKey, runId,
      maxScore, avgScore, minScore,
      finalClassification: classification,
      topCandidateName: top?.candidate.name ?? null,
      topCandidateScore: top?.score.finalScore ?? null,
      overrideRequired: classification === 'ambiguous',
    };
    return { ...op, ...biz };
  }
}
