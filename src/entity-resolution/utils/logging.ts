/**
 * entity-resolution/utils/logging.ts
 *
 * Padrão único de logging estruturado para o Entity Resolution Engine.
 *
 * PRINCÍPIO (ajustes #4 e #5 do roadmap):
 * Cada etapa do pipeline produz exactamente:
 *   - início (com contexto)
 *   - fim (com duração + resultado)
 * Sem logs excessivos dentro dos algoritmos.
 * Formato JSON/pino, consistente com o restante da plataforma.
 *
 * Todos os componentes importam de aqui — nunca do pino directamente.
 * Isso garante um formato único e permite substituir o logger em testes.
 */

import { logger as pinoLogger } from '../../lib/logger.js';
import type { AutoClassification } from '../types/domain.js';

// ── PipelineMetrics — recolhidas em cada resolução ────────────────────────────

export interface PipelineMetrics {
  activityId:           string;
  productKey:           string;
  runId:                string;

  // Volumes
  candidatesGenerated:  number;   // após CandidateGenerator
  candidatesFiltered:   number;   // após CandidatePreFilter
  candidatesScored:     number;   // após Matchers (= filtered, mas explícito)

  // Tempos por componente (ms)
  generatorMs:          number;
  preFilterMs:          number;
  nameMatcherMs:        number;
  geoMatcherMs:         number;
  addressMatcherMs:     number;
  hybridMs:             number;
  classifierMs:         number;
  persistenceMs:        number;
  totalMs:              number;

  // Qualidade dos scores
  maxScore:             number;
  avgScore:             number;
  minScore:             number;

  // Resultado
  finalClassification:  AutoClassification;
  topCandidateName:     string | null;
  topCandidateScore:    number | null;
}

// ── ERLogger — wrapper com métodos específicos do pipeline ────────────────────

export const ERLogger = {
  /**
   * Início de uma run de resolução em batch.
   */
  runStarted(runId: string, productKey: string, activitiesCount: number): void {
    pinoLogger.info({ runId, productKey, activitiesCount, event: 'er_run_started' },
      'Entity Resolution run iniciada');
  },

  /**
   * Fim de uma run de resolução em batch.
   */
  runFinished(runId: string, productKey: string, summary: {
    activitiesProcessed: number;
    matched: number;
    ambiguous: number;
    unresolved: number;
    proposed_new: number;
    failed: number;
    totalMs: number;
  }): void {
    pinoLogger.info({ runId, productKey, ...summary, event: 'er_run_finished' },
      'Entity Resolution run concluída');
  },

  /**
   * Run falhou.
   */
  runFailed(runId: string, productKey: string, reason: string): void {
    pinoLogger.error({ runId, productKey, reason, event: 'er_run_failed' },
      'Entity Resolution run falhou');
  },

  /**
   * Início da resolução de uma actividade individual.
   */
  activityStarted(activityId: string, runId: string, mentionText: string | null): void {
    pinoLogger.debug({ activityId, runId, mentionText, event: 'er_activity_started' },
      'Resolvendo actividade');
  },

  /**
   * Fim da resolução de uma actividade — log principal de cada resolução.
   * Inclui todas as métricas do pipeline.
   */
  activityResolved(metrics: PipelineMetrics): void {
    pinoLogger.info({
      ...metrics,
      event: 'er_activity_resolved',
    }, `ER: ${metrics.finalClassification} — score=${metrics.topCandidateScore?.toFixed(3) ?? 'n/a'} — ${metrics.totalMs}ms`);
  },

  /**
   * Actividade ignorada porque já tem decisão humana (ADR-0013).
   */
  activitySkipped(activityId: string, runId: string, reason: string): void {
    pinoLogger.info({ activityId, runId, reason, event: 'er_activity_skipped' },
      'Actividade ignorada — decisão já existente');
  },

  /**
   * Actividade sem VenueMention — não há nada a resolver.
   */
  activityNoMention(activityId: string, runId: string): void {
    pinoLogger.debug({ activityId, runId, event: 'er_no_mention' },
      'Actividade sem VenueMention — ignorada');
  },

  /**
   * Falha na resolução de uma actividade individual.
   */
  activityFailed(activityId: string, runId: string, error: unknown): void {
    pinoLogger.error({ activityId, runId, error: String(error), event: 'er_activity_failed' },
      'Falha na resolução da actividade');
  },

  /**
   * Métricas de um componente individual do pipeline (debug).
   * Usado internamente para diagnóstico — não aparece em produção com INFO.
   */
  componentTimed(component: string, activityId: string, durationMs: number, detail?: Record<string, unknown>): void {
    pinoLogger.debug({ component, activityId, durationMs, ...detail, event: 'er_component_timed' },
      `${component}: ${durationMs}ms`);
  },
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
