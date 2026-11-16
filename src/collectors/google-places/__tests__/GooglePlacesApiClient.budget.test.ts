/**
 * L5 r0 — custo incerto e tentativas repetidas com o GooglePlacesApiClient
 * REAL e um fetch falso (sem rede). Verifica reservas e tectos pelo
 * InMemoryBudgetRepo:
 *   - HTTP 200 seguido de falha a ler o corpo → conta como gasto;
 *   - resposta perdida + repetições → cada tentativa conta;
 *   - recusa a meio das repetições → nenhum fetch seguinte;
 *   - falha antes de enviar (fase de ligação) → libertada.
 */
import { describe, it, expect, vi } from 'vitest';
import { GooglePlacesApiClient, billableOfFetchError } from '../GooglePlacesApiClient';
import { GooglePlacesCollector } from '../GooglePlacesCollector';
import { BudgetGuard, BudgetRefusedError, InMemoryBudgetRepo, type BudgetConfig } from '../../../lib/budgetGuard';
import type { GooglePlacesProductConfig } from '../config/GooglePlacesProductConfig';

const TS = 0.032;
const PD = 0.017;
const PARAMS = { query: 'qa', lat: -22.9, lng: -42.0, radiusMeters: 1000 };

function setup(over: Partial<BudgetConfig> = {}) {
  const repo = new InMemoryBudgetRepo({ provider: 'google_places', monthly_budget_usd: 10, hard_stop_enabled: true, ...over });
  let n = 0;
  const guard = new BudgetGuard(repo, {
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    newRunKey: () => `run-${++n}`,
  });
  return { repo, guard, gate: guard.attemptGate('google_places') };
}

function client(fetchImpl: (...a: unknown[]) => Promise<Response>) {
  const f = vi.fn(fetchImpl);
  return { f, api: new GooglePlacesApiClient('chave-falsa', { fetch: f as unknown as typeof fetch, baseDelayMs: 0 }) };
}

/** Gasto que o repositório conta para esta execução (sonda de 0 USD). */
async function spentRun(repo: InMemoryBudgetRepo, guard: BudgetGuard): Promise<number | null> {
  const r = await repo.reserve({ provider: 'google_places', callType: 'sonda', runKey: guard.currentRunKey, ingestionRunId: null, estimatedCostUsd: 0 });
  return r.spentRun;
}

function lostResponse(): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
}

function connectRefused(): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
}

describe('HTTP 200 seguido de falha a ler o corpo → gasto', () => {
  it('textSearch: lança, mas a tentativa conta como gasto', async () => {
    const { repo, guard, gate } = setup();
    const { f, api } = client(async () => new Response('isto não é json{', { status: 200 }));
    await expect(api.textSearch(PARAMS, gate)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
    expect(guard.costSummary().totals).toMatchObject({ spent_count: 1, spent_usd: TS, released_count: 0, pending_count: 0 });
    expect(await spentRun(repo, guard)).toBeCloseTo(TS, 6);
  });

  it('getEnrichedDetails: devolve details null, mas a tentativa conta como gasto (o catch não engole o custo)', async () => {
    const { repo, guard, gate } = setup();
    const { f, api } = client(async () => new Response('{corpo partido', { status: 200 }));
    const r = await api.getEnrichedDetails('place-1', gate);
    expect(r.details).toBeNull();
    expect(r.costUsd).toBeCloseTo(PD, 6);
    expect(f).toHaveBeenCalledTimes(1);
    expect(guard.costSummary().totals).toMatchObject({ spent_count: 1, spent_usd: PD, released_count: 0 });
    expect(await spentRun(repo, guard)).toBeCloseTo(PD, 6);
  });

  it('resposta não-2xx → incerta, conta como gasto (sem repetição)', async () => {
    const { guard, gate } = setup();
    const { f, api } = client(async () => new Response('erro', { status: 500 }));
    await expect(api.textSearch(PARAMS, gate)).rejects.toThrow(/500/);
    expect(f).toHaveBeenCalledTimes(1);
    expect(guard.costSummary().totals).toMatchObject({ spent_count: 1, released_count: 0 });
  });
});

describe('tentativas repetidas: cada tentativa HTTP é reservada', () => {
  it('textSearch: resposta perdida 3 vezes → 3 reservas, 3 gastos', async () => {
    const { repo, guard, gate } = setup();
    const { f, api } = client(async () => {
      throw lostResponse();
    });
    await expect(api.textSearch(PARAMS, gate)).rejects.toThrow('fetch failed');
    expect(f).toHaveBeenCalledTimes(3);
    expect(guard.costSummary().totals).toMatchObject({ reserved_count: 3, spent_count: 3, released_count: 0 });
    expect(await spentRun(repo, guard)).toBeCloseTo(3 * TS, 6);
  });

  it('perdida e depois 200 → 2 gastos', async () => {
    const { guard, gate } = setup();
    let call = 0;
    const { f, api } = client(async () => {
      if (++call === 1) throw lostResponse();
      return new Response(JSON.stringify({ places: [] }), { status: 200 });
    });
    const r = await api.textSearch(PARAMS, gate);
    expect(r.places).toEqual([]);
    expect(r.costUsd).toBeCloseTo(2 * TS, 6);
    expect(f).toHaveBeenCalledTimes(2);
    expect(guard.costSummary().totals).toMatchObject({ spent_count: 2 });
  });

  it('recusa a meio das repetições pára os fetch seguintes', async () => {
    // Tecto por execução cabe exactamente 2 tentativas de text_search.
    const { repo, guard, gate } = setup({ per_run_budget_usd: 2 * TS });
    const { f, api } = client(async () => {
      throw lostResponse();
    });
    const err = await api.textSearch(PARAMS, gate).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetRefusedError);
    expect((err as BudgetRefusedError).attemptsSent).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
    expect(guard.costSummary().totals).toMatchObject({ reserved_count: 2, spent_count: 2, refused_count: 1 });
    expect(await spentRun(repo, guard)).toBeCloseTo(2 * TS, 6);
  });

  it('getEnrichedDetails: recusa logo na 1.ª tentativa → nenhum fetch, budgetRefusedReason preenchido', async () => {
    const { gate } = setup({ per_run_budget_usd: 0 });
    const { f, api } = client(async () => new Response('{}', { status: 200 }));
    const r = await api.getEnrichedDetails('place-1', gate);
    expect(f).not.toHaveBeenCalled();
    expect(r.budgetRefusedReason).toMatch(/por execução/);
    expect(r.costUsd).toBe(0);
  });
});

describe('falha antes de enviar → libertada', () => {
  it('fase de ligação (ECONNREFUSED) em todas as tentativas → tudo libertado, nada gasto', async () => {
    const { repo, guard, gate } = setup();
    const { f, api } = client(async () => {
      throw connectRefused();
    });
    const r = await api.getEnrichedDetails('place-1', gate);
    expect(r.details).toBeNull();
    expect(r.costUsd).toBe(0);
    expect(f).toHaveBeenCalledTimes(2);
    expect(guard.costSummary().totals).toMatchObject({ reserved_count: 2, spent_count: 0, released_count: 2, pending_count: 0 });
    expect(await spentRun(repo, guard)).toBe(0);
  });

  it('classificação: só códigos da fase de ligação são "no"; o resto é incerto', () => {
    expect(billableOfFetchError(connectRefused())).toBe('no');
    expect(billableOfFetchError(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }))).toBe('no');
    expect(billableOfFetchError(lostResponse())).toBe('uncertain');
    expect(billableOfFetchError(new Error('desconhecido'))).toBe('uncertain');
    expect(billableOfFetchError(null)).toBe('uncertain');
  });
});

describe('GooglePlacesCollector com o cliente real', () => {
  const CONFIG: GooglePlacesProductConfig = {
    product_key: 'qa', source_key: 'google_places',
    source_priority: 70,
    regions: [{ key: 'cidade_qa', display_label: 'Cidade QA', lat: -22.9, lng: -42.0, radius_m: 1000 }],
    categories: [{ key: 'teatro', query_text: 'teatro', kind: 'place_type' }],
    monthly_budget_usd: 10,
    hard_stop_enabled: true,
    alert_threshold_pct: 0.8,
  };

  it('orçamento por execução a zero → query pulada sem nenhum fetch', async () => {
    const { guard } = setup({ per_run_budget_usd: 0 });
    const { f, api } = client(async () => new Response('{}', { status: 200 }));
    const result = await new GooglePlacesCollector(api, guard, CONFIG).collect();
    expect(f).not.toHaveBeenCalled();
    expect(result.stats.queries_skipped_budget).toBe(1);
  });

  it('200 com corpo partido no enriquecimento → item segue, custo contado', async () => {
    const { guard } = setup();
    const place = { id: 'p1', displayName: { text: 'Teatro QA' }, location: { latitude: -22.9, longitude: -42.0 } };
    const { api } = client(async (url: unknown) =>
      String(url).includes('searchText')
        ? new Response(JSON.stringify({ places: [place] }), { status: 200 })
        : new Response('{partido', { status: 200 }),
    );
    const result = await new GooglePlacesCollector(api, guard, CONFIG).collect();
    expect(result.items).toHaveLength(1);
    expect(guard.costSummary().totals).toMatchObject({ spent_count: 2, released_count: 0 });
  });
});

// Revisão r1 do L5 (BAIXO): o custo reportado pelo collector conta TODAS as
// tentativas liquidadas como gasto, incluindo as de pedidos que acabam em excepção.
describe('GooglePlacesCollector — estimated_cost_usd = gasto real por tentativa', () => {
  const CONFIG: GooglePlacesProductConfig = {
    product_key: 'qa', source_key: 'google_places', source_priority: 70,
    regions: [{ key: 'cidade_qa', display_label: 'Cidade QA', lat: -22.9, lng: -42.0, radius_m: 1000 }],
    categories: [{ key: 'teatro', query_text: 'teatro', kind: 'place_type' }],
    monthly_budget_usd: 10, hard_stop_enabled: true, alert_threshold_pct: 0.8,
  };

  it('textSearch falha depois de enviar (respostas perdidas, todas as repetições) → todas as tentativas no custo', async () => {
    const { guard } = setup();
    const { f, api } = client(async () => { throw lostResponse(); });
    const result = await new GooglePlacesCollector(api, guard, CONFIG).collect();
    const sent = f.mock.calls.length;
    expect(sent).toBeGreaterThan(1);
    expect(result.stats.estimated_cost_usd).toBeCloseTo(Math.round(sent * TS * 100) / 100, 6);
    expect(guard.costSummary().totals.spent_usd).toBeCloseTo(sent * TS, 6);
  });

  it('recusa de orçamento a meio das repetições → as tentativas já enviadas contam', async () => {
    const { guard } = setup({ per_run_budget_usd: TS * 1.5 }); // cabe 1 tentativa
    const { f, api } = client(async () => { throw lostResponse(); });
    const result = await new GooglePlacesCollector(api, guard, CONFIG).collect();
    expect(f).toHaveBeenCalledTimes(1);
    expect(result.stats.queries_skipped_budget).toBe(1);
    expect(result.stats.estimated_cost_usd).toBeCloseTo(Math.round(TS * 100) / 100, 6);
  });

  it('falha antes de enviar (ligação recusada) → libertada, custo 0', async () => {
    const { guard } = setup();
    const { api } = client(async () => { throw connectRefused(); });
    const result = await new GooglePlacesCollector(api, guard, CONFIG).collect();
    expect(result.stats.estimated_cost_usd).toBe(0);
    expect(guard.costSummary().totals.spent_count).toBe(0);
  });

  it('caminho feliz: custo igual ao do orçamento (pesquisa + detalhes)', async () => {
    const { guard } = setup();
    const place = { id: 'p1', displayName: { text: 'Teatro QA' }, location: { latitude: -22.9, longitude: -42.0 } };
    const { api } = client(async (url: unknown) =>
      String(url).includes('searchText')
        ? new Response(JSON.stringify({ places: [place] }), { status: 200 })
        : new Response(JSON.stringify({ id: 'p1' }), { status: 200 }),
    );
    const result = await new GooglePlacesCollector(api, guard, CONFIG).collect();
    expect(result.stats.estimated_cost_usd).toBeCloseTo(Math.round(guard.costSummary().totals.spent_usd * 100) / 100, 6);
  });

  it('duas execuções do mesmo collector não acumulam custo entre si', async () => {
    const { guard } = setup();
    const { api } = client(async () => new Response(JSON.stringify({ places: [] }), { status: 200 }));
    const collector = new GooglePlacesCollector(api, guard, CONFIG);
    const r1 = await collector.collect();
    const r2 = await collector.collect();
    expect(r1.stats.estimated_cost_usd).toBeCloseTo(Math.round(TS * 100) / 100, 6);
    expect(r2.stats.estimated_cost_usd).toBeCloseTo(Math.round(TS * 100) / 100, 6);
  });
});

describe('GooglePlacesCollector — isolamento por execução (revisão r0 do #31)', () => {
  const CONFIG: GooglePlacesProductConfig = {
    product_key: 'qa', source_key: 'google_places', source_priority: 70,
    regions: [{ key: 'cidade_qa', display_label: 'Cidade QA', lat: -22.9, lng: -42.0, radius_m: 1000 }],
    categories: [{ key: 'teatro', query_text: 'teatro', kind: 'place_type' }],
    monthly_budget_usd: 10, hard_stop_enabled: true, alert_threshold_pct: 0.8,
  };

  it('collect() concorrente na mesma instância é recusado; a primeira execução reporta só o seu custo', async () => {
    const { guard } = setup();
    let release!: () => void;
    const gateOpen = new Promise<void>((r) => { release = r; });
    const { api } = client(async () => { await gateOpen; return new Response(JSON.stringify({ places: [] }), { status: 200 }); });
    const collector = new GooglePlacesCollector(api, guard, CONFIG);
    const first = collector.collect();
    await expect(collector.collect()).rejects.toThrow(/já em curso/);
    release();
    const r1 = await first;
    expect(r1.stats.estimated_cost_usd).toBeCloseTo(Math.round(TS * 100) / 100, 6);
    const r2 = await collector.collect(); // depois de terminar, volta a aceitar
    expect(r2.stats.estimated_cost_usd).toBeCloseTo(Math.round(TS * 100) / 100, 6);
  });

  it('settle() repetido no mesmo ticket conta uma só vez', async () => {
    const { guard } = setup();
    const settles: Array<() => Promise<void>> = [];
    const fakeApi = {
      textSearch: async (_p: unknown, gate: { begin: (c: string, e: number) => Promise<{ ok: boolean; settle?: (b: 'yes') => Promise<void> }> }) => {
        const ticket = await gate.begin('textSearch', TS);
        if (ticket.ok && ticket.settle) { await ticket.settle('yes'); settles.push(() => ticket.settle!('yes')); await ticket.settle('yes'); }
        return { places: [], costUsd: TS };
      },
      getEnrichedDetails: async () => ({ details: null, costUsd: 0 }),
    } as unknown as GooglePlacesApiClient;
    const result = await new GooglePlacesCollector(fakeApi, guard, CONFIG).collect();
    expect(result.stats.estimated_cost_usd).toBeCloseTo(Math.round(TS * 100) / 100, 6);
  });
});

it('settle('no') seguido de settle('yes') no mesmo ticket não conta (a primeira liquidação decide)', async () => {
  const { guard } = setup();
  const CONFIG: GooglePlacesProductConfig = {
    product_key: 'qa', source_key: 'google_places', source_priority: 70,
    regions: [{ key: 'cidade_qa', display_label: 'Cidade QA', lat: -22.9, lng: -42.0, radius_m: 1000 }],
    categories: [{ key: 'teatro', query_text: 'teatro', kind: 'place_type' }],
    monthly_budget_usd: 10, hard_stop_enabled: true, alert_threshold_pct: 0.8,
  };
  const fakeApi = {
    textSearch: async (_p: unknown, gate: { begin: (c: string, e: number) => Promise<{ ok: boolean; settle?: (b: 'yes' | 'no' | 'uncertain') => Promise<void> }> }) => {
      const ticket = await gate.begin('textSearch', TS);
      if (ticket.ok && ticket.settle) { await ticket.settle('no'); await ticket.settle('yes'); await ticket.settle('uncertain'); }
      return { places: [], costUsd: 0 };
    },
    getEnrichedDetails: async () => ({ details: null, costUsd: 0 }),
  } as unknown as GooglePlacesApiClient;
  const result = await new GooglePlacesCollector(fakeApi, guard, CONFIG).collect();
  expect(result.stats.estimated_cost_usd).toBe(0);
  expect(guard.costSummary().totals.spent_count).toBe(0);
});
