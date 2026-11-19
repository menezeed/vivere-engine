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

// 19/11/2026: timeout por tentativa. Expirar depois de enviar = gasto incerto.
import { PLACES_REQUEST_TIMEOUT_MS } from '../GooglePlacesApiClient';
describe('GooglePlacesApiClient — timeout por tentativa', () => {
  function hanging() {
    return vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      const s = init?.signal;
      if (s) s.addEventListener('abort', () => rej(s.reason), { once: true });
    }));
  }

  it('resposta que nunca chega → TimeoutError, cada tentativa conta como gasto (incerto) e tem o seu sinal', async () => {
    const { guard, gate } = setup();
    const f = hanging();
    const api = new GooglePlacesApiClient('chave-falsa', { fetch: f as unknown as typeof fetch, baseDelayMs: 0, timeoutMs: 15 });
    const err = await api.textSearch(PARAMS, gate).catch((e: unknown) => e);
    expect((err as Error).name).toBe('TimeoutError');
    const sent = f.mock.calls.length;
    expect(sent).toBeGreaterThan(1);
    expect(new Set(f.mock.calls.map((c) => c[1]?.signal)).size).toBe(sent);
    expect(guard.costSummary().totals).toMatchObject({ spent_count: sent, released_count: 0, pending_count: 0 });
  });

  it('resposta rápida não é afectada e o pedido continua a levar a chave e o field mask', async () => {
    const { gate } = setup();
    const f = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ places: [] }), { status: 200 }));
    const api = new GooglePlacesApiClient('chave-falsa', { fetch: f as unknown as typeof fetch, baseDelayMs: 0, timeoutMs: 1000 });
    await expect(api.textSearch(PARAMS, gate)).resolves.toMatchObject({ places: [] });
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init.headers).get('X-Goog-Api-Key')).toBe('chave-falsa');
    expect(new Headers(init.headers).get('X-Goog-FieldMask')).toBeTruthy();
  });

  it('30 s por omissão; timeout inválido é recusado', () => {
    expect(PLACES_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(() => new GooglePlacesApiClient('k', { timeoutMs: 0 })).toThrow(/positivo/);
    expect(() => new GooglePlacesApiClient('k', { timeoutMs: Number.NaN })).toThrow(/positivo/);
    expect(() => new GooglePlacesApiClient('k', { timeoutMs: 1.5 })).toThrow(/inteiro/);
  });

  /** HTTP 200 cujo corpo nunca termina; erra quando o sinal da tentativa aborta. */
  function hangingBody() {
    return vi.fn(async (_url: unknown, init?: RequestInit) => {
      const s = init?.signal;
      const body = new ReadableStream({
        start(c) { s?.addEventListener('abort', () => c.error(s.reason), { once: true }); },
      });
      return new Response(body, { status: 200 });
    });
  }

  it('textSearch: corpo pendurado depois de HTTP 200 → TimeoutError, 1 tentativa, 1 liquidação, sem pendentes', async () => {
    const { guard, gate } = setup();
    const f = hangingBody();
    const api = new GooglePlacesApiClient('chave-falsa', { fetch: f as unknown as typeof fetch, baseDelayMs: 0, timeoutMs: 15 });
    const err = await api.textSearch(PARAMS, gate).catch((e: unknown) => e);
    expect((err as Error).name).toBe('TimeoutError');
    expect(f).toHaveBeenCalledTimes(1); // resposta recebida: não repete
    expect(guard.costSummary().totals).toMatchObject({ spent_count: 1, released_count: 0, pending_count: 0 });
  });

  it('getEnrichedDetails: corpo pendurado depois de HTTP 200 → details null, 1 liquidação, sem pendentes', async () => {
    const { guard, gate } = setup();
    const f = hangingBody();
    const api = new GooglePlacesApiClient('chave-falsa', { fetch: f as unknown as typeof fetch, baseDelayMs: 0, timeoutMs: 15 });
    const r = await api.getEnrichedDetails('p1', gate);
    expect(r.details).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(guard.costSummary().totals).toMatchObject({ spent_count: 1, released_count: 0, pending_count: 0 });
  });
});
