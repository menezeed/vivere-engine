/**
 * Issue #62 — 403 da guarda de elegibilidade ≠ 403 de falta de papel (RBAC).
 * O HTTP 403 mantém-se; muda só a mensagem e o aviso global.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiRequest, ApiError, ACCESS_DENIED_EVENT, ACCESS_DENIED_MESSAGE, ELIGIBILITY_BLOCKED_MESSAGE,
  describeApiError, isAccessDenied, isEligibilityBlocked, shouldRetryQuery,
} from '../client';

let dispatched: Event[];
const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

beforeEach(() => {
  dispatched = [];
  vi.stubGlobal('localStorage', { getItem: () => 'token-de-teste', setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('window', { location: { href: '/activities' }, dispatchEvent: (e: Event) => { dispatched.push(e); return true; } });
  vi.stubGlobal('CustomEvent', class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail; }
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

const BLOCKED = { error: "'approve' bloqueado: a elegibilidade 60+ desta actividade não está confirmada", code: 'ELIGIBILITY_NOT_CONFIRMED' };

describe('403 de elegibilidade', () => {
  it('continua a ser ApiError 403, mas sem o aviso global de acesso negado', async () => {
    respond(403, BLOCKED);
    const err = await apiRequest('/api/activities/x/approve', { method: 'PATCH' }).catch((e: unknown) => e) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(dispatched).toHaveLength(0);
    expect(isEligibilityBlocked(err)).toBe(true);
    expect(isAccessDenied(err)).toBe(false);
    expect(describeApiError(err)).toBe(ELIGIBILITY_BLOCKED_MESSAGE);
    expect(describeApiError(err)).not.toMatch(/papel|administrador/);
  });

  it('403 de RBAC (sem código) mantém o aviso e a mensagem de falta de permissão', async () => {
    respond(403, { error: 'Papel sem permissão' });
    const err = await apiRequest('/api/activities/x/approve', { method: 'PATCH' }).catch((e: unknown) => e) as ApiError;
    expect(dispatched.map(e => e.type)).toEqual([ACCESS_DENIED_EVENT]);
    expect(isAccessDenied(err)).toBe(true);
    expect(describeApiError(err)).toBe(ACCESS_DENIED_MESSAGE);
  });

  it('outro código no corpo não é tratado como elegibilidade', () => {
    expect(isEligibilityBlocked(new ApiError(403, { code: 'OUTRO' }))).toBe(false);
    expect(isEligibilityBlocked(new ApiError(400, BLOCKED))).toBe(false);
  });

  it('não é repetido pelo retry das queries', () => {
    expect(shouldRetryQuery(0, new ApiError(403, BLOCKED))).toBe(false);
  });
});
