/**
 * Issue #52 — rotas /api/catalog/* na app Hono: autenticação (SEC-B),
 * papel (SEC-A), só leitura (405), desactivado por omissão (503) e
 * isolamento da fila de staging. Sem rede nem base de dados.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp } from '../../app';
import { createJwtVerifier } from '../../middleware/jwtVerifier';
import { FixtureCatalogSource } from '../FixtureCatalogSource';
import type { ReviewService } from '../../services/ReviewService';
import type { EntityResolutionService } from '../../services/EntityResolutionService';
import type { StatsRepository } from '../../repositories/StatsRepository';
import type { IIngestionRunReadRepository } from '../../../persistence/types/repositoryInterfaces';
import type { CatalogSource } from '../catalogTypes';

const SUPABASE_URL = 'https://test-project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const KID = 'kid-catalog';
let signingKey: CryptoKey;
let publicJwk: JsonWebKey;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

async function token(role?: string): Promise<string> {
  const head = b64({ alg: 'ES256', typ: 'JWT', kid: KID });
  const body = b64({ sub: 'u1', email: 't@example.test', aud: 'authenticated', role: 'authenticated', iss: ISSUER,
    iat: now() - 5, exp: now() + 600, ...(role ? { app_metadata: { role } } : {}) });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(new Uint8Array(sig)).toString('base64url')}`;
}

const jwksFetch = vi.fn(async (url: string | URL | Request) => {
  if (String(url) === `${ISSUER}/.well-known/jwks.json`) {
    return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] }), { status: 200 });
  }
  throw new Error(`fetch inesperado: ${String(url)}`);
});

// Fila de staging: qualquer chamada aqui num pedido de catálogo é uma falha de isolamento.
const svc = { listVenues: vi.fn(), getVenue: vi.fn(), reviewVenue: vi.fn(), listActivities: vi.fn(), getActivity: vi.fn(), reviewActivity: vi.fn() };
const er = { getHealth: vi.fn(), listQueue: vi.fn(), getStats: vi.fn(), listCandidates: vi.fn(), accept: vi.fn(), override: vi.fn(), proposeNew: vi.fn() };
const runRepo = { list: vi.fn() };
const statsRepo = { getPlatformStats: vi.fn() };
const stagingMocks = () => [...Object.values(svc), ...Object.values(er), runRepo.list, statsRepo.getPlatformStats];

function build(catalogSource?: CatalogSource) {
  return createApp({
    corsOrigin: ['http://localhost:5173'], requestLogging: false,
    reviewService: svc as unknown as ReviewService, erService: er as unknown as EntityResolutionService,
    runRepo: runRepo as unknown as IIngestionRunReadRepository, statsRepo: statsRepo as unknown as StatsRepository,
    jwtVerifier: createJwtVerifier({ supabaseUrl: SUPABASE_URL, fetchImpl: jwksFetch as unknown as typeof fetch,
      logger: { warn: () => undefined, error: () => undefined } }),
    catalogSource,
  });
}

const fixture = new FixtureCatalogSource();
const spySource = (): CatalogSource & Record<string, ReturnType<typeof vi.fn>> => ({
  target: 'production',
  listActivities: vi.fn(fixture.listActivities.bind(fixture)), getActivity: vi.fn(fixture.getActivity.bind(fixture)),
  listVenues: vi.fn(fixture.listVenues.bind(fixture)), getVenue: vi.fn(fixture.getVenue.bind(fixture)),
  listCategories: vi.fn(fixture.listCategories.bind(fixture)),
}) as never;

async function call(app: ReturnType<typeof build>, method: string, path: string, tk?: string) {
  return app.request(path, { method, headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  signingKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { throw new Error(`fetch global inesperado: ${u}`); }));
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => stagingMocks().forEach((m) => m.mockClear()));

describe('/api/catalog — autenticação e papel', () => {
  it('401 sem token e 403 sem papel, sem tocar na fonte', async () => {
    const s = spySource(); const app = build(s);
    expect((await call(app, 'GET', '/api/catalog/activities')).status).toBe(401);
    expect((await call(app, 'GET', '/api/catalog/activities', await token())).status).toBe(403);
    expect(s.listActivities).not.toHaveBeenCalled();
  });
  it.each(['viewer', 'reviewer', 'admin'])('%s lê o catálogo', async (role) => {
    const res = await call(build(spySource()), 'GET', '/api/catalog/activities', await token(role));
    expect(res.status).toBe(200);
  });
});

describe('/api/catalog — só leitura', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s → 405, mesmo para admin, sem tocar na fonte', async (m) => {
    const s = spySource(); const app = build(s);
    for (const p of ['/api/catalog/activities', '/api/catalog/activities/00000000-0000-4000-8000-000000000001', '/api/catalog/venues']) {
      expect((await call(app, m, p, await token('admin'))).status).toBe(405);
    }
    Object.values(s).forEach((fn) => { if (typeof fn === 'function' && 'mock' in fn) expect(fn).not.toHaveBeenCalled(); });
  });
});

describe('/api/catalog — desactivado por omissão', () => {
  it('sem catalogSource responde 503 CATALOG_DISABLED', async () => {
    const res = await call(build(), 'GET', '/api/catalog/activities', await token('viewer'));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'CATALOG_DISABLED' });
  });
});

describe('/api/catalog — contrato', () => {
  it('rejects a fixture-only client before calling a production source', async () => {
    const source = spySource();
    const app = build(source);
    const bearer = await token('viewer');
    for (const path of ['/activities', '/venues', '/categories', '/activities/00000000-0000-4000-8000-000000000001']) {
      const response = await call(app, 'GET', `/api/catalog${path}?expected_target=fixture`, bearer);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'CATALOG_TARGET_MISMATCH' });
    }
    expect(source.listActivities).not.toHaveBeenCalled();
    expect(source.listVenues).not.toHaveBeenCalled();
    expect(source.listCategories).not.toHaveBeenCalled();
    expect(source.getActivity).not.toHaveBeenCalled();
  });

  it('serves the fixture-only client from the synthetic source with no-store', async () => {
    const response = await call(build(new FixtureCatalogSource()), 'GET',
      '/api/catalog/activities?expected_target=fixture&pageSize=2', await token('viewer'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ totalPages: 2, environment: { target: 'fixture', access: 'read-only' } });
  });

  it('lista com paginação, rótulo PRODUÇÃO — SOMENTE LEITURA e completude', async () => {
    const res = await call(build(spySource()), 'GET', '/api/catalog/activities?pageSize=2&sort=title&order=asc', await token('viewer'));
    const body = await res.json() as Record<string, any>;
    expect(body.environment).toEqual({ target: 'production', access: 'read-only', label: 'PRODUÇÃO — SOMENTE LEITURA' });
    expect(body).toMatchObject({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
    expect(body.items[0].completeness).toHaveProperty('missing');
  });
  it('fixture é rotulada como dados sintéticos', async () => {
    const body = await (await call(build(new FixtureCatalogSource()), 'GET', '/api/catalog/status', await token('viewer'))).json() as Record<string, any>;
    expect(body.environment.label).toBe('DADOS SINTÉTICOS — SOMENTE LEITURA');
  });
  it.each([
    ['pageSize=0'], ['pageSize=101'], ['page=-1'], ['sort=drop'], ['order=up'], ['engine_status=deleted'], ['category=a%20b'],
  ])('400 para %s', async (qs) => {
    expect((await call(build(spySource()), 'GET', `/api/catalog/activities?${qs}`, await token('viewer'))).status).toBe(400);
  });
  it('detalhe: 400 para id não-UUID, 404 inexistente, 200 existente', async () => {
    const app = build(spySource()); const tk = await token('viewer');
    expect((await call(app, 'GET', '/api/catalog/venues/abc', tk)).status).toBe(400);
    expect((await call(app, 'GET', '/api/catalog/venues/00000000-0000-4000-8000-0000000000ff', tk)).status).toBe(404);
    const ok = await call(app, 'GET', '/api/catalog/venues/00000000-0000-4000-8000-0000000000a1', tk);
    expect(ok.status).toBe(200);
  });
  it('falha da produção → 502 genérico, sem detalhes internos', async () => {
    const s = spySource(); (s.listVenues as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNRESET host interno'));
    const res = await call(build(s), 'GET', '/api/catalog/venues', await token('viewer'));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('ECONNRESET');
  });
});

describe('isolamento da fila de staging', () => {
  it('pedidos ao catálogo nunca chamam serviços/repositórios de staging', async () => {
    const app = build(spySource()); const tk = await token('admin');
    for (const p of ['/api/catalog/activities', '/api/catalog/venues', '/api/catalog/categories', '/api/catalog/status']) {
      await call(app, 'GET', p, tk);
    }
    stagingMocks().forEach((m) => expect(m).not.toHaveBeenCalled());
  });
  it('a fila de staging continua a responder sem tocar no catálogo', async () => {
    const s = spySource();
    svc.listActivities.mockResolvedValueOnce({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 });
    const res = await call(build(s), 'GET', '/api/activities', await token('viewer'));
    expect(res.status).toBe(200);
    expect(s.listActivities).not.toHaveBeenCalled();
  });
});
