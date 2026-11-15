/**
 * L5 — guarda de orçamento: reserva → chamada → confirm/release, tectos
 * mensal/diário/por execução, hard_stop, alertas 50/80/100 e selecção do
 * modo nos scripts. Sem rede.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  BudgetGuard,
  InMemoryBudgetRepo,
  budgetRepoForRun,
  checkBudgetBeforeCall,
  resolveBudgetMode,
  type BudgetConfig,
  type BudgetRepo,
} from '../budgetGuard';

function quietLog() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
}

function cfg(over: Partial<BudgetConfig> = {}): BudgetConfig {
  return { provider: 'google_places', monthly_budget_usd: 10, hard_stop_enabled: true, ...over };
}

let runCounter = 0;
const newRunKey = () => `run-${++runCounter}`;

function paidSpy(costUsd = 1) {
  return vi.fn(async () => ({ value: 'resultado', costUsd }));
}

const CALL = { provider: 'google_places', callType: 'text_search', estimatedCostUsd: 1 };

describe('checkBudgetBeforeCall — tectos (nenhuma chamada paga quando excedido)', () => {
  it('mensal excedido → recusa e a API não é chamada', async () => {
    const guard = new BudgetGuard(new InMemoryBudgetRepo(cfg({ monthly_budget_usd: 2 })), { log: quietLog(), newRunKey });
    const paid = paidSpy();
    expect((await checkBudgetBeforeCall(guard, CALL, paid)).allowed).toBe(true);
    expect((await checkBudgetBeforeCall(guard, CALL, paid)).allowed).toBe(true);
    const third = await checkBudgetBeforeCall(guard, CALL, paid);
    expect(third).toMatchObject({ allowed: false });
    expect(third.allowed === false && third.reason).toMatch(/orçamento mensal/);
    expect(paid).toHaveBeenCalledTimes(2);
  });

  it('diário excedido → recusa; no dia seguinte (UTC) volta a permitir', async () => {
    let now = new Date('2026-11-15T23:30:00Z');
    const repo = new InMemoryBudgetRepo(cfg({ daily_budget_usd: 1 }), () => now);
    const guard = new BudgetGuard(repo, { log: quietLog(), newRunKey, now: () => now });
    const paid = paidSpy();
    expect((await checkBudgetBeforeCall(guard, CALL, paid)).allowed).toBe(true);
    const refused = await checkBudgetBeforeCall(guard, CALL, paid);
    expect(refused.allowed === false && refused.reason).toMatch(/orçamento diário/);
    expect(paid).toHaveBeenCalledTimes(1);
    now = new Date('2026-11-16T00:10:00Z'); // 21:10 em Brasília, mas já outro dia UTC
    expect((await checkBudgetBeforeCall(guard, CALL, paid)).allowed).toBe(true);
    expect(paid).toHaveBeenCalledTimes(2);
  });

  it('por execução excedido → recusa; nova execução (startRun) volta a permitir', async () => {
    const guard = new BudgetGuard(new InMemoryBudgetRepo(cfg({ per_run_budget_usd: 1 })), { log: quietLog(), newRunKey });
    const paid = paidSpy();
    expect((await checkBudgetBeforeCall(guard, CALL, paid)).allowed).toBe(true);
    const refused = await checkBudgetBeforeCall(guard, CALL, paid);
    expect(refused.allowed === false && refused.reason).toMatch(/por execução/);
    guard.startRun();
    expect((await checkBudgetBeforeCall(guard, CALL, paid)).allowed).toBe(true);
    expect(paid).toHaveBeenCalledTimes(2);
  });

  it('sem config para o fornecedor → recusa (fail-closed)', async () => {
    const guard = new BudgetGuard(new InMemoryBudgetRepo(cfg()), { log: quietLog(), newRunKey });
    const paid = paidSpy();
    const r = await checkBudgetBeforeCall(guard, { ...CALL, provider: 'outro_fornecedor' }, paid);
    expect(r.allowed === false && r.reason).toMatch(/sem configuração/);
    expect(paid).not.toHaveBeenCalled();
  });

  it('repositório lança na reserva → recusa e regista erro', async () => {
    const log = quietLog();
    const repo: BudgetRepo = {
      reserve: vi.fn(async () => {
        throw new Error('rede indisponível');
      }),
      confirm: vi.fn(),
      release: vi.fn(),
    };
    const guard = new BudgetGuard(repo, { log, newRunKey });
    const paid = paidSpy();
    const r = await checkBudgetBeforeCall(guard, CALL, paid);
    expect(r.allowed).toBe(false);
    expect(paid).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(guard.costSummary().totals.refused_count).toBe(1);
  });

  it('hard_stop=false → permitido acima do tecto, com aviso', async () => {
    const log = quietLog();
    const guard = new BudgetGuard(new InMemoryBudgetRepo(cfg({ monthly_budget_usd: 1, hard_stop_enabled: false })), { log, newRunKey });
    const paid = paidSpy();
    await checkBudgetBeforeCall(guard, CALL, paid);
    const second = await checkBudgetBeforeCall(guard, CALL, paid);
    expect(second.allowed).toBe(true);
    expect(paid).toHaveBeenCalledTimes(2);
    const softWarn = log.warn.mock.calls.filter(([, msg]) => String(msg).includes('hard_stop desabilitado'));
    expect(softWarn).toHaveLength(1);
    expect(softWarn[0][0]).toMatchObject({ reason: 'soft_monthly_cap' });
  });
});

describe('checkBudgetBeforeCall — liquidação', () => {
  it('custo > 0 → confirm; custo 0 → release; falha da API → release e propaga', async () => {
    const inner = new InMemoryBudgetRepo(cfg({ monthly_budget_usd: 1.5 }));
    const repo = {
      reserve: vi.fn(inner.reserve.bind(inner)),
      confirm: vi.fn(inner.confirm.bind(inner)),
      release: vi.fn(inner.release.bind(inner)),
    };
    const guard = new BudgetGuard(repo, { log: quietLog(), newRunKey });

    await checkBudgetBeforeCall(guard, CALL, paidSpy(1));
    expect(repo.confirm).toHaveBeenCalledTimes(1);

    await checkBudgetBeforeCall(guard, { ...CALL, estimatedCostUsd: 0.5 }, paidSpy(0));
    expect(repo.release).toHaveBeenCalledTimes(1);

    await expect(
      checkBudgetBeforeCall(guard, { ...CALL, estimatedCostUsd: 0.5 }, async () => {
        throw new Error('HTTP 503');
      }),
    ).rejects.toThrow('HTTP 503');
    expect(repo.release).toHaveBeenCalledTimes(2);

    // As libertações não contam: ainda cabe 0.5 (1 gasto + 0.5 = 1.5).
    expect((await checkBudgetBeforeCall(guard, { ...CALL, estimatedCostUsd: 0.5 }, paidSpy(0.5))).allowed).toBe(true);

    const s = guard.costSummary();
    expect(s.totals).toMatchObject({
      reserved_count: 4,
      spent_count: 2,
      spent_usd: 1.5,
      released_count: 2,
      released_usd: 1,
      pending_count: 0,
      refused_count: 0,
    });
    expect(s.by_provider_call_type).toHaveLength(1);
    expect(s.by_provider_call_type[0]).toMatchObject({ provider: 'google_places', call_type: 'text_search' });
  });

  it('falha ao confirmar → regista erro e a reserva fica pendente', async () => {
    const log = quietLog();
    const inner = new InMemoryBudgetRepo(cfg());
    const repo: BudgetRepo = {
      reserve: inner.reserve.bind(inner),
      confirm: async () => {
        throw new Error('rpc indisponível');
      },
      release: inner.release.bind(inner),
    };
    const guard = new BudgetGuard(repo, { log, newRunKey });
    const r = await checkBudgetBeforeCall(guard, CALL, paidSpy(1));
    expect(r.allowed).toBe(true);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(guard.costSummary().totals).toMatchObject({ pending_count: 1, pending_usd: 1, spent_count: 0 });
  });

  it('resumo por fornecedor e call_type', async () => {
    const guard = new BudgetGuard(new InMemoryBudgetRepo(cfg()), { log: quietLog(), newRunKey, mode: 'memory' });
    await checkBudgetBeforeCall(guard, { ...CALL, estimatedCostUsd: 0.032 }, paidSpy(0.032));
    await checkBudgetBeforeCall(guard, { ...CALL, callType: 'place_details_enriched', estimatedCostUsd: 0.017 }, paidSpy(0.017));
    const s = guard.costSummary();
    expect(s.budget_mode).toBe('memory');
    expect(s.by_provider_call_type.map((l) => [l.call_type, l.spent_usd])).toEqual([
      ['place_details_enriched', 0.017],
      ['text_search', 0.032],
    ]);
    expect(s.totals.spent_usd).toBe(0.049);
  });
});

describe('alertas 50/80/100%', () => {
  function alerts(log: ReturnType<typeof quietLog>) {
    return log.warn.mock.calls
      .map(([obj]) => obj as Record<string, unknown>)
      .filter((o) => o && o.alert === 'api_budget_threshold');
  }

  it('cada limiar alerta uma única vez por âmbito', async () => {
    const log = quietLog();
    const guard = new BudgetGuard(new InMemoryBudgetRepo(cfg({ monthly_budget_usd: 10 })), { log, newRunKey });
    // 10 chamadas de 1 USD: 50% na 5.ª, 80% na 8.ª, 100% na 10.ª; a 11.ª é recusada.
    for (let i = 0; i < 11; i++) await checkBudgetBeforeCall(guard, CALL, paidSpy(1));
    const month = alerts(log).filter((a) => a.scope === 'month');
    expect(month.map((a) => a.threshold)).toEqual([0.5, 0.8, 1]);
    expect(month[0]).toMatchObject({ provider: 'google_places', scope: 'month', spent: 5, budget: 10, pct: 50 });
  });

  it('salto acima de vários limiares emite cada um uma vez; âmbitos independentes', async () => {
    const log = quietLog();
    const guard = new BudgetGuard(
      new InMemoryBudgetRepo(cfg({ monthly_budget_usd: 100, daily_budget_usd: 10, per_run_budget_usd: 2 })),
      { log, newRunKey },
    );
    await checkBudgetBeforeCall(guard, CALL, paidSpy(1)); // run 50%
    await checkBudgetBeforeCall(guard, CALL, paidSpy(1)); // run 100% (80 e 100)
    const run = alerts(log).filter((a) => a.scope === 'run').map((a) => a.threshold);
    expect(run).toEqual([0.5, 0.8, 1]);
    expect(alerts(log).filter((a) => a.scope === 'day')).toHaveLength(0); // 20% do dia
    expect(alerts(log).filter((a) => a.scope === 'month')).toHaveLength(0);

    // Nova execução: o âmbito 'run' volta a alertar (período novo).
    guard.startRun();
    await checkBudgetBeforeCall(guard, CALL, paidSpy(1));
    expect(alerts(log).filter((a) => a.scope === 'run')).toHaveLength(4);
  });
});

describe('resolveBudgetMode / budgetRepoForRun', () => {
  it('omissão = memory', () => {
    expect(resolveBudgetMode(['node', 'x'], false)).toEqual({ ok: true, mode: 'memory' });
  });

  it('--budget=persistent aceite fora de dry-run', () => {
    expect(resolveBudgetMode(['node', 'x', '--budget=persistent'], false)).toEqual({ ok: true, mode: 'persistent' });
  });

  it('--budget=persistent com --dry-run é recusado', () => {
    const r = resolveBudgetMode(['node', 'x', '--budget=persistent', '--dry-run'], true);
    expect(r.ok).toBe(false);
  });

  it('valor inválido ou repetido é recusado', () => {
    expect(resolveBudgetMode(['--budget=db'], false).ok).toBe(false);
    expect(resolveBudgetMode(['--budget=memory', '--budget=persistent'], false).ok).toBe(false);
  });

  it('memory nunca cria o repositório persistente', async () => {
    const createPersistent = vi.fn(async () => {
      throw new Error('não devia ser chamado');
    });
    const repo = await budgetRepoForRun('memory', cfg(), createPersistent);
    expect(repo).toBeInstanceOf(InMemoryBudgetRepo);
    expect(createPersistent).not.toHaveBeenCalled();
  });

  it('persistent usa a fábrica injectada', async () => {
    const fake: BudgetRepo = { reserve: vi.fn(), confirm: vi.fn(), release: vi.fn() };
    const repo = await budgetRepoForRun('persistent', cfg(), async () => fake);
    expect(repo).toBe(fake);
  });
});
