import type { SupabaseClient } from '@supabase/supabase-js';
import {
  refusedReservation,
  type BudgetRepo,
  type BudgetReservation,
  type BudgetReserveRequest,
} from '../../lib/budgetGuard';

/**
 * BudgetRepo persistente (L5, migração 0026): chama as RPC atómicas de
 * staging. Recebe o cliente único (getSupabaseClient → envGuard); nunca
 * cria um cliente próprio.
 *
 * reserve() nunca lança: erro da RPC, resposta vazia ou malformada →
 * recusa (fail-closed; a API paga não é chamada). confirm()/release()
 * lançam em erro: o BudgetGuard regista-o e a reserva continua a contar
 * para o tecto (lado seguro).
 */

/** Linha devolvida por staging.reserve_api_budget (0026). */
interface ReserveRow {
  allowed: boolean | null;
  reason: string | null;
  reservation_id: number | string | null;
  spent_month_usd: number | string | null;
  spent_day_usd: number | string | null;
  spent_run_usd: number | string | null;
  budget_month_usd: number | string | null;
  budget_day_usd: number | string | null;
  budget_run_usd: number | string | null;
  hard_stop: boolean | null;
  alert_thresholds: Array<number | string> | null;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export class SupabaseBudgetRepo implements BudgetRepo {
  constructor(private readonly db: SupabaseClient) {}

  async reserve(req: BudgetReserveRequest): Promise<BudgetReservation> {
    let data: unknown;
    let error: { message: string } | null;
    try {
      ({ data, error } = await this.db.schema('staging').rpc('reserve_api_budget', {
        p_provider: req.provider,
        p_call_type: req.callType,
        p_run_key: req.runKey,
        p_ingestion_run_id: req.ingestionRunId,
        p_estimated_cost_usd: req.estimatedCostUsd,
      }));
    } catch (err) {
      return refusedReservation(`rpc_error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (error) return refusedReservation(`rpc_error: ${error.message}`);

    const row = (Array.isArray(data) ? data[0] : data) as ReserveRow | undefined | null;
    if (!row || typeof row !== 'object') return refusedReservation('empty_response');

    const reservationId = row.reservation_id === null || row.reservation_id === undefined
      ? null
      : String(row.reservation_id);
    const allowed = row.allowed === true && reservationId !== null;
    const thresholds = Array.isArray(row.alert_thresholds)
      ? row.alert_thresholds.map((t) => num(t)).filter((t): t is number => t !== null)
      : null;

    return {
      allowed,
      reason: row.reason ?? (allowed ? null : 'refused'),
      reservationId: allowed ? reservationId : null,
      spentMonth: num(row.spent_month_usd),
      spentDay: num(row.spent_day_usd),
      spentRun: num(row.spent_run_usd),
      limits: row.budget_month_usd === null || row.budget_month_usd === undefined
        ? null
        : { month: num(row.budget_month_usd), day: num(row.budget_day_usd), run: num(row.budget_run_usd) },
      hardStopEnabled: row.hard_stop ?? null,
      alertThresholds: thresholds,
    };
  }

  async confirm(reservationId: string): Promise<void> {
    await this.settle('confirm_api_spend', reservationId);
  }

  async release(reservationId: string): Promise<void> {
    await this.settle('release_api_budget', reservationId);
  }

  private async settle(fn: 'confirm_api_spend' | 'release_api_budget', reservationId: string): Promise<void> {
    const id = Number(reservationId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`SupabaseBudgetRepo.${fn}: reservation_id inválido (${reservationId})`);
    }
    const { error } = await this.db.schema('staging').rpc(fn, { p_reservation_id: id });
    if (error) {
      throw new Error(`SupabaseBudgetRepo.${fn}: ${error.message}`);
    }
  }
}
