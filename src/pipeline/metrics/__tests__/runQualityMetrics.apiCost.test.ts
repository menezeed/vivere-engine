/**
 * L5 — o resumo de custo de API (BudgetGuard.costSummary) entra no
 * relatório de qualidade da execução só quando fornecido.
 */
import { describe, it, expect, vi } from 'vitest';
import { computeRunQualityMetrics, formatRunQualitySummary } from '../runQualityMetrics';
import { BudgetGuard, InMemoryBudgetRepo, checkBudgetBeforeCall } from '../../../lib/budgetGuard';

const GENERATED_AT = '2026-11-15T12:00:00.000Z';

describe('runQualityMetrics — api_cost', () => {
  it('sem apiCost o relatório não ganha o campo', () => {
    const report = computeRunQualityMetrics([], { generatedAt: GENERATED_AT });
    expect('api_cost' in report).toBe(false);
    expect(formatRunQualitySummary(report)).not.toMatch(/Custo de API/);
  });

  it('com apiCost inclui o resumo e a linha legível', async () => {
    const guard = new BudgetGuard(
      new InMemoryBudgetRepo({ provider: 'google_places', monthly_budget_usd: 10, hard_stop_enabled: true }),
      { log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }, mode: 'memory' },
    );
    await checkBudgetBeforeCall(
      guard,
      { provider: 'google_places', callType: 'text_search', estimatedCostUsd: 0.032 },
      async () => ({ value: null, billable: 'yes' as const }),
    );
    const report = computeRunQualityMetrics([], { generatedAt: GENERATED_AT, apiCost: guard.costSummary() });
    expect(report.api_cost?.totals.spent_usd).toBe(0.032);
    const text = formatRunQualitySummary(report);
    expect(text).toMatch(/Custo de API \(memory\): gasto USD 0\.032 \(1\)/);
    expect(text).toMatch(/google_places\/text_search: gasto USD 0\.032 \(1\)/);
  });
});
