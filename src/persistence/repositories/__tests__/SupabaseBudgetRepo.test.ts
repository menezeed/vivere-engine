/**
 * SupabaseBudgetRepo (L5) — sem rede: cliente Supabase falso que regista
 * as chamadas rpc() e devolve respostas programadas.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseBudgetRepo } from '../SupabaseBudgetRepo';
import { BudgetGuard, NotBilledError, checkBudgetBeforeCall } from '../../../lib/budgetGuard';

type RpcResult = { data: unknown; error: { message: string } | null };

function fakeClient(handler: (fn: string, args: Record<string, unknown>) => RpcResult | Promise<RpcResult>) {
  const calls: Array<{ schema: string; fn: string; args: Record<string, unknown> }> = [];
  const client = {
    schema: (schema: string) => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ schema, fn, args });
        return handler(fn, args);
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const ALLOWED_ROW = {
  allowed: true,
  reason: null,
  reservation_id: 42,
  spent_month_usd: '0.0320',
  spent_day_usd: '0.0320',
  spent_run_usd: '0.0320',
  budget_month_usd: '10.0000',
  budget_day_usd: '2.0000',
  budget_run_usd: '1.0000',
  hard_stop: true,
  alert_thresholds: ['0.5', '0.8', '1.0'],
};

const REQ = {
  provider: 'google_places',
  callType: 'text_search',
  runKey: '00000000-0000-4000-8000-000000000001',
  ingestionRunId: null,
  estimatedCostUsd: 0.032,
};

describe('SupabaseBudgetRepo.reserve', () => {
  it('chama staging.reserve_api_budget com os argumentos mapeados e converte a resposta', async () => {
    const { client, calls } = fakeClient(() => ({ data: [ALLOWED_ROW], error: null }));
    const r = await new SupabaseBudgetRepo(client).reserve({ ...REQ, ingestionRunId: 'run-1' });

    expect(calls).toEqual([
      {
        schema: 'staging',
        fn: 'reserve_api_budget',
        args: {
          p_provider: 'google_places',
          p_call_type: 'text_search',
          p_run_key: REQ.runKey,
          p_ingestion_run_id: 'run-1',
          p_estimated_cost_usd: 0.032,
        },
      },
    ]);
    expect(r).toEqual({
      allowed: true,
      reason: null,
      reservationId: '42',
      spentMonth: 0.032,
      spentDay: 0.032,
      spentRun: 0.032,
      limits: { month: 10, day: 2, run: 1 },
      hardStopEnabled: true,
      alertThresholds: [0.5, 0.8, 1],
    });
  });

  it('erro da RPC → recusa (não lança)', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: 'permission denied' } }));
    const r = await new SupabaseBudgetRepo(client).reserve(REQ);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/^rpc_error: permission denied/);
    expect(r.reservationId).toBeNull();
  });

  it('excepção do cliente → recusa', async () => {
    const { client } = fakeClient(() => {
      throw new Error('fetch failed');
    });
    const r = await new SupabaseBudgetRepo(client).reserve(REQ);
    expect(r).toMatchObject({ allowed: false, reason: 'rpc_error: fetch failed' });
  });

  it('sem config (no_config) → recusa', async () => {
    const { client } = fakeClient(() => ({
      data: [{ ...ALLOWED_ROW, allowed: false, reason: 'no_config', reservation_id: null, budget_month_usd: null }],
      error: null,
    }));
    const r = await new SupabaseBudgetRepo(client).reserve(REQ);
    expect(r).toMatchObject({ allowed: false, reason: 'no_config', reservationId: null, limits: null });
  });

  it('resposta vazia → recusa', async () => {
    const { client } = fakeClient(() => ({ data: [], error: null }));
    const r = await new SupabaseBudgetRepo(client).reserve(REQ);
    expect(r).toMatchObject({ allowed: false, reason: 'empty_response' });
  });

  it('allowed=true sem reservation_id → recusa', async () => {
    const { client } = fakeClient(() => ({ data: [{ ...ALLOWED_ROW, reservation_id: null }], error: null }));
    const r = await new SupabaseBudgetRepo(client).reserve(REQ);
    expect(r.allowed).toBe(false);
  });
});

describe('SupabaseBudgetRepo.confirm / release', () => {
  it('chamam as RPC com p_reservation_id numérico', async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: null }));
    const repo = new SupabaseBudgetRepo(client);
    await repo.confirm('42');
    await repo.release('43');
    expect(calls).toEqual([
      { schema: 'staging', fn: 'confirm_api_spend', args: { p_reservation_id: 42 } },
      { schema: 'staging', fn: 'release_api_budget', args: { p_reservation_id: 43 } },
    ]);
  });

  it('erro da RPC lança', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: 'ja liquidada' } }));
    await expect(new SupabaseBudgetRepo(client).confirm('42')).rejects.toThrow(/ja liquidada/);
  });
});

describe('SupabaseBudgetRepo + checkBudgetBeforeCall', () => {
  const quiet = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

  it('erro da RPC de reserva → nenhuma chamada paga', async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: { message: 'boom' } }));
    const guard = new BudgetGuard(new SupabaseBudgetRepo(client), { log: quiet });
    const paid = vi.fn(async () => ({ value: 1, billable: 'yes' as const }));
    const r = await checkBudgetBeforeCall(guard, { provider: 'google_places', callType: 'text_search', estimatedCostUsd: 0.032 }, paid);
    expect(r.allowed).toBe(false);
    expect(paid).not.toHaveBeenCalled();
    expect(calls.map((c) => c.fn)).toEqual(['reserve_api_budget']);
  });

  it('reserva aceite → chamada → confirm_api_spend', async () => {
    const { client, calls } = fakeClient((fn) => (fn === 'reserve_api_budget' ? { data: [ALLOWED_ROW], error: null } : { data: null, error: null }));
    const guard = new BudgetGuard(new SupabaseBudgetRepo(client), { log: quiet });
    const r = await checkBudgetBeforeCall(guard, { provider: 'google_places', callType: 'text_search', estimatedCostUsd: 0.032 }, async () => ({ value: 'ok', billable: 'yes' as const }));
    expect(r.allowed).toBe(true);
    expect(calls.map((c) => c.fn)).toEqual(['reserve_api_budget', 'confirm_api_spend']);
  });

  it('API falha com custo incerto → confirm_api_spend (conservador) e a excepção propaga', async () => {
    const { client, calls } = fakeClient((fn) => (fn === 'reserve_api_budget' ? { data: [ALLOWED_ROW], error: null } : { data: null, error: null }));
    const guard = new BudgetGuard(new SupabaseBudgetRepo(client), { log: quiet });
    await expect(
      checkBudgetBeforeCall(guard, { provider: 'google_places', callType: 'text_search', estimatedCostUsd: 0.032 }, async () => {
        throw new Error('HTTP 500');
      }),
    ).rejects.toThrow('HTTP 500');
    expect(calls.map((c) => c.fn)).toEqual(['reserve_api_budget', 'confirm_api_spend']);
  });

  it('pedido comprovadamente não enviado (NotBilledError) → release_api_budget', async () => {
    const { client, calls } = fakeClient((fn) => (fn === 'reserve_api_budget' ? { data: [ALLOWED_ROW], error: null } : { data: null, error: null }));
    const guard = new BudgetGuard(new SupabaseBudgetRepo(client), { log: quiet });
    await expect(
      checkBudgetBeforeCall(guard, { provider: 'google_places', callType: 'text_search', estimatedCostUsd: 0.032 }, async () => {
        throw new NotBilledError('não enviado');
      }),
    ).rejects.toThrow('não enviado');
    expect(calls.map((c) => c.fn)).toEqual(['reserve_api_budget', 'release_api_budget']);
  });
});
