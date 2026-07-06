/**
 * entity-resolution/types/result.ts
 *
 * Result Pattern do Entity Resolution Engine.
 *
 * Inspirado em Result<T, E> de linguagens funcionais.
 * Nenhuma função do ER retorna boolean nem lança erros de domínio —
 * retorna um Result que o chamador inspeciona de forma explícita.
 *
 * Quatro variantes alinhadas com o domínio:
 *   Success        — resolução completa, candidato identificado
 *   PartialSuccess — processado com degradação (ex: alguns matchers falharam)
 *   Unresolved     — processado sem candidato plausível
 *   Failed         — falha técnica (banco, configuração, etc.)
 *
 * Usar discriminated union — TypeScript estreita o tipo automaticamente:
 *
 *   const r = await engine.resolve(activityId, config);
 *   if (r.kind === 'success') {
 *     console.log(r.result.topCandidate);   // TypeScript sabe que topCandidate existe
 *   }
 */

import type { ResolutionResult } from './domain.js';
import type { ERError } from '../errors/index.js';

// ── Variantes do Result ───────────────────────────────────────────────────────

export interface SuccessResult {
  readonly kind:    'success';
  readonly result:  ResolutionResult;
}

export interface PartialSuccessResult {
  readonly kind:    'partial';
  readonly result:  ResolutionResult;
  readonly warnings: readonly string[];   // ex: "GeoMatcher ignorado — coordenadas ausentes"
}

export interface UnresolvedResult {
  readonly kind:    'unresolved';
  readonly result:  ResolutionResult;    // classification = 'proposed_new' ou 'unresolved'
  readonly reason:  UnresolvedReason;
}

export interface FailedResult {
  readonly kind:    'failed';
  readonly error:   ERError;
  readonly partial?: ResolutionResult;   // resultado parcial se o motor chegou a gerar candidatos
}

export type ERResult =
  | SuccessResult
  | PartialSuccessResult
  | UnresolvedResult
  | FailedResult;

// ── Razões de unresolved ──────────────────────────────────────────────────────

export type UnresolvedReason =
  | 'no_venue_mention'          // actividade sem VenueMention — nada a resolver
  | 'empty_pool'                // nenhum venue approved/promoted no produto
  | 'all_below_threshold'       // candidatos existem mas nenhum atingiu minSuggestion
  | 'prefilter_eliminated_all'  // PreFilter removeu todos os candidatos (raio, cidade)
  | 'proposed_new_confirmed';   // score < minSuggestion — sinaliza venue novo

// ── Factories de conveniência ─────────────────────────────────────────────────

export function success(result: ResolutionResult): SuccessResult {
  return { kind: 'success', result };
}

export function partial(result: ResolutionResult, warnings: string[]): PartialSuccessResult {
  return { kind: 'partial', result, warnings };
}

export function unresolved(result: ResolutionResult, reason: UnresolvedReason): UnresolvedResult {
  return { kind: 'unresolved', result, reason };
}

export function failed(error: ERError, partial?: ResolutionResult): FailedResult {
  return { kind: 'failed', error, ...(partial ? { partial } : {}) };
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isSuccess(r: ERResult): r is SuccessResult {
  return r.kind === 'success';
}

export function isPartial(r: ERResult): r is PartialSuccessResult {
  return r.kind === 'partial';
}

export function isUnresolved(r: ERResult): r is UnresolvedResult {
  return r.kind === 'unresolved';
}

export function isFailed(r: ERResult): r is FailedResult {
  return r.kind === 'failed';
}

/** True se o resultado tem um ResolutionResult (mesmo que unresolved). */
export function hasResult(r: ERResult): r is SuccessResult | PartialSuccessResult | UnresolvedResult {
  return r.kind !== 'failed';
}

// ── Result de batch ───────────────────────────────────────────────────────────

/**
 * Resultado de uma execução em batch (múltiplas actividades).
 * Output de EntityResolutionEngine.resolveAll().
 */
export interface BatchERResult {
  readonly runId:    string;
  readonly results:  readonly ERResult[];
  readonly summary: {
    readonly total:        number;
    readonly succeeded:    number;
    readonly partial:      number;
    readonly unresolved:   number;
    readonly failed:       number;
    readonly durationMs:   number;
  };
}
