/**
 * entity-resolution/utils/logging.ts
 *
 * Padrão único de logging e métricas do Entity Resolution Engine.
 *
 * AJUSTE #2 — Métricas separadas em operacional e negócio.
 * AJUSTE #3 — IERLogger injectável — nenhum componente escreve directamente
 *             no pino. Recebem IERLogger por injecção. Mesmo padrão
 *             de desacoplamento do restante da plataforma.
 * AJUSTE #4 — ERLogger de produção usa pino. ERSilentLogger para testes.
 */

import { logger as pinoLogger } from '../../lib/logger.js';
import type { AutoClassification } from '../types/domain.js';

// ── Métricas operacionais ─────────────────────────────────────────────────────

/**
 * O que o sistema fez — tempos, volumes, recursos.
 * Útil para diagnóstico de performance, alertas de SLA, optimização.
 */
export interface OperationalMetrics {
  activityId:          string;
  productKey:          string;
  runId:               string;

  // Volumes do pipeline
  candidatesGenerated: number;   // pool bruto do Generator
  candidatesFiltered:  number;   // após PreFilter
  candidatesScored:    number;   // após Matchers (= filtered, explícito por clareza)

  // Duração por componente (ms)
  generatorMs:         number;
  preFilterMs:         number;
  nameMatcherMs:       number;
  geoMatcherMs:        number;
  addressMatcherMs:    number;
  hybridMs:            number;
  classifierMs:        number;
  persistenceMs:       number;
  totalMs:             number;
}

// ── Métricas de negócio ───────────────────────────────────────────────────────

/**
 * O que o negócio quer saber — qualidade das resoluções, distribuição
 * de classificações, confiança do motor.
 * Útil para calibração de thresholds, relatórios operacionais, ADR updates.
 */
export interface BusinessMetrics {
  activityId:           string;
  productKey:           string;
  runId:                string;

  // Qualidade dos scores
  maxScore:             number;
  avgScore:             number;
  minScore:             number;

  // Resultado da resolução
  finalClassification:  AutoClassification;
  topCandidateName:     string | null;
  topCandidateScore:    number | null;
  overrideRequired:     boolean;  // true se score ≥ highConfidence mas ambiguous
}

// ── PipelineMetrics — agregado para persistência ──────────────────────────────

/**
 * União de operacional + negócio.
 * Persiste em match_detail JSONB de venue_resolution_candidates.
 * Também vai para o log estruturado em cada resolução.
 */
export interface PipelineMetrics extends OperationalMetrics, BusinessMetrics {}

// ── IERLogger — interface injectável ─────────────────────────────────────────

/**
 * Contrato de logging do Entity Resolution Engine.
 * TODOS os componentes recebem IERLogger por injecção.
 * Nenhum componente importa pino directamente.
 *
 * Benefício imediato: testes usam ERSilentLogger (sem output).
 * Benefício futuro: substituir por OpenTelemetry sem alterar componentes.
 */
export interface IERLogger {
  runStarted(runId: string, productKey: string, activitiesCount: number): void;
  runFinished(runId: string, productKey: string, summary: RunSummaryLog): void;
  runFailed(runId: string, productKey: string, reason: string): void;
  activityStarted(activityId: string, runId: string, mentionText: string | null): void;
  activityResolved(metrics: PipelineMetrics): void;
  activitySkipped(activityId: string, runId: string, reason: string): void;
  activityNoMention(activityId: string, runId: string): void;
  activityFailed(activityId: string, runId: string, error: unknown): void;
  componentTimed(component: string, activityId: string, durationMs: number, detail?: Record<string, unknown>): void;
}

export interface RunSummaryLog {
  activitiesProcessed: number;
  matched:             number;
  ambiguous:           number;
  unresolved:          number;
  proposed_new:        number;
  failed:              number;
  totalMs:             number;
}

// ── ERLogger — implementação de produção (usa pino) ───────────────────────────

export const ERLogger: IERLogger = {
  runStarted(runId, productKey, activitiesCount) {
    pinoLogger.info({ runId, productKey, activitiesCount, event: 'er_run_started' },
      'Entity Resolution run iniciada');
  },

  runFinished(runId, productKey, summary) {
    pinoLogger.info({ runId, productKey, ...summary, event: 'er_run_finished' },
      'Entity Resolution run concluída');
  },

  runFailed(runId, productKey, reason) {
    pinoLogger.error({ runId, productKey, reason, event: 'er_run_failed' },
      'Entity Resolution run falhou');
  },

  activityStarted(activityId, runId, mentionText) {
    pinoLogger.debug({ activityId, runId, mentionText, event: 'er_activity_started' },
      'Resolvendo actividade');
  },

  activityResolved(metrics) {
    pinoLogger.info({
      operational: {
        candidatesGenerated: metrics.candidatesGenerated,
        candidatesFiltered:  metrics.candidatesFiltered,
        totalMs:             metrics.totalMs,
        generatorMs:         metrics.generatorMs,
        preFilterMs:         metrics.preFilterMs,
        nameMatcherMs:       metrics.nameMatcherMs,
        geoMatcherMs:        metrics.geoMatcherMs,
        addressMatcherMs:    metrics.addressMatcherMs,
        hybridMs:            metrics.hybridMs,
        persistenceMs:       metrics.persistenceMs,
      },
      business: {
        finalClassification: metrics.finalClassification,
        topCandidateScore:   metrics.topCandidateScore,
        topCandidateName:    metrics.topCandidateName,
        maxScore:            metrics.maxScore,
        avgScore:            metrics.avgScore,
        overrideRequired:    metrics.overrideRequired,
      },
      activityId: metrics.activityId,
      event: 'er_activity_resolved',
    }, `ER: ${metrics.finalClassification} — score=${metrics.topCandidateScore?.toFixed(3) ?? 'n/a'} — ${metrics.totalMs}ms`);
  },

  activitySkipped(activityId, runId, reason) {
    pinoLogger.info({ activityId, runId, reason, event: 'er_activity_skipped' },
      'Actividade ignorada — decisão já existente');
  },

  activityNoMention(activityId, runId) {
    pinoLogger.debug({ activityId, runId, event: 'er_no_mention' },
      'Actividade sem VenueMention — ignorada');
  },

  activityFailed(activityId, runId, error) {
    pinoLogger.error({ activityId, runId, error: String(error), event: 'er_activity_failed' },
      'Falha na resolução da actividade');
  },

  componentTimed(component, activityId, durationMs, detail) {
    pinoLogger.debug({ component, activityId, durationMs, ...detail, event: 'er_component_timed' },
      `${component}: ${durationMs}ms`);
  },
};

// ── ERSilentLogger — para testes (sem output) ─────────────────────────────────

/**
 * Logger que não escreve nada.
 * Injectar nos testes unitários e de integração para silenciar output.
 *
 * Uso nos testes:
 *   const engine = new EntityResolutionEngine(repos, matchers, ERSilentLogger);
 */
export const ERSilentLogger: IERLogger = {
  runStarted:       () => {},
  runFinished:      () => {},
  runFailed:        () => {},
  activityStarted:  () => {},
  activityResolved: () => {},
  activitySkipped:  () => {},
  activityNoMention:() => {},
  activityFailed:   () => {},
  componentTimed:   () => {},
};

// ── Timer utilitário ──────────────────────────────────────────────────────────

/**
 * Timer simples para medir duração de etapas do pipeline.
 * Uso: const t = startTimer(); ... const ms = t.stop();
 */
export function startTimer(): { stop: () => number } {
  const start = Date.now();
  return { stop: () => Date.now() - start };
}
