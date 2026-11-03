/**
 * SEC-A — comportamento do Admin Panel para 401 e 403 (sem rede: fetch,
 * localStorage e window são substituídos por duplos de teste).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiRequest, ApiError, ACCESS_DENIED_EVENT, ACCESS_DENIED_MESSAGE,
  describeApiError, isAccessDenied, shouldRetryQuery,
} from '../client';
import { parseUserRole } from '../../auth/roles';

let store: Map<string, string>;
let dispatched: Event[];
let location: { href: string };

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

beforeEach(() => {
  store = new Map([['vivere_access_token', 'token-de-teste'], ['vivere_user', '{"id":"u"}']]);
  dispatched = [];
  location = { href: '/dashboard' };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  vi.stubGlobal('window', { location, dispatchEvent: (e: Event) => { dispatched.push(e); return true; } });
  vi.stubGlobal('CustomEvent', class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail; }
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('apiRequest — 401', () => {
  it('remove o token, redirecciona para /login e lança ApiError(401)', async () => {
    respond(401, { error: 'Token inválido ou expirado' });
    await expect(apiRequest('/api/venues')).rejects.toMatchObject({ status: 401 });
    expect(store.has('vivere_access_token')).toBe(false);
    expect(location.href).toBe('/login');
    expect(dispatched).toHaveLength(0);
  });
});

describe('apiRequest — 403', () => {
  it('mantém a sessão, não redirecciona e emite o evento de acesso negado', async () => {
    respond(403, { error: 'Conta sem papel autorizado para o Review API' });
    const err = (await apiRequest('/api/venues').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.body).toEqual({ error: 'Conta sem papel autorizado para o Review API' });
    expect(store.get('vivere_access_token')).toBe('token-de-teste');
    expect(store.has('vivere_user')).toBe(true);
    expect(location.href).toBe('/dashboard');
    expect(dispatched.map((e) => e.type)).toEqual([ACCESS_DENIED_EVENT]);
  });

  it('403 com corpo não-JSON continua a ser ApiError(403)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })));
    await expect(apiRequest('/api/venues')).rejects.toMatchObject({ status: 403, body: null });
  });
});

describe('apiRequest — outros estados (inalterados)', () => {
  it('200 devolve o corpo e envia o Bearer', async () => {
    respond(200, { data: [1] });
    await expect(apiRequest('/api/venues')).resolves.toEqual({ data: [1] });
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer token-de-teste' });
  });

  it('500 lança ApiError(500) sem logout nem evento', async () => {
    respond(500, { error: 'Erro interno do servidor' });
    await expect(apiRequest('/api/venues')).rejects.toMatchObject({ status: 500 });
    expect(store.get('vivere_access_token')).toBe('token-de-teste');
    expect(dispatched).toHaveLength(0);
  });
});

describe('mensagens e retry', () => {
  it('describeApiError dá texto próprio a 403 e mantém o resto', () => {
    expect(isAccessDenied(new ApiError(403, null))).toBe(true);
    expect(describeApiError(new ApiError(403, null))).toBe(ACCESS_DENIED_MESSAGE);
    expect(describeApiError(new ApiError(500, null))).toBe('ApiError: API error 500');
  });

  it('não repete 401 nem 403; repete outros erros uma vez, como antes', () => {
    expect(shouldRetryQuery(0, new ApiError(401, null))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(403, null))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(500, null))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError(500, null))).toBe(false);
    expect(shouldRetryQuery(0, new TypeError('rede'))).toBe(true);
  });
});

describe('parseUserRole', () => {
  it.each(['viewer', 'reviewer', 'admin'])('aceita %s', (r) => {
    expect(parseUserRole(r)).toBe(r);
  });
  it.each([undefined, null, '', 'superuser', 'Admin', 1, ['admin'], {}])('sem papel para %j', (v) => {
    expect(parseUserRole(v)).toBeNull();
  });
});
