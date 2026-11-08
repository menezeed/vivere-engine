/**
 * SEC-A — autenticação e autorização do Review API, ponta a ponta na app
 * Hono, sem rede nem base de dados: o JWKS é servido por um fetch falso e
 * os tokens são assinados com um par ES256 gerado no próprio teste.
 *
 * SEC-B: os tokens imitam os do Supabase (header com kid, iss, aud e role
 * top-level) e o verificador é injectado em createApp com fetch falso.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApp, MUTATION_ROLE_MATRIX } from '../app';
import { resolveAuthUser } from '../middleware/auth';
import { createJwtVerifier } from '../middleware/jwtVerifier';
import { logger } from '../../lib/logger';
import type { ReviewService } from '../services/ReviewService';
import type { EntityResolutionService } from '../services/EntityResolutionService';
import type { StatsRepository } from '../repositories/StatsRepository';
import type { IIngestionRunReadRepository } from '../../persistence/types/repositoryInterfaces';
import type { UserRole } from '../types/reviewTypes';

// ── Chaves e tokens de teste ────────────────────────────────────────────────

const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
let signingKey: CryptoKey;   // a chave publicada no JWKS falso
let foreignKey: CryptoKey;   // outra chave: assinatura válida, mas não do projecto

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const b64urlJson = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

const SUPABASE_URL = 'https://test-project.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const KID = 'test-kid-es256';
const silentLog = { warn: () => undefined, error: () => undefined };

async function sign(
  claims: Record<string, unknown>,
  key: CryptoKey = signingKey,
  header: Record<string, unknown> = { alg: 'ES256', typ: 'JWT', kid: KID },
): Promise<string> {
  const head = b64urlJson(header);
  const body = b64urlJson(claims);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const baseClaims = (extra: Record<string, unknown> = {}) => ({
  sub: 'user-123', email: 'tester@example.test', aud: 'authenticated', role: 'authenticated',
  iss: ISSUER, iat: nowSec() - 5, exp: nowSec() + 3600, ...extra,
});
const tokenFor = (role: unknown) => sign(baseClaims({ app_metadata: { role } }));

// ── App com serviços falsos ─────────────────────────────────────────────────

const svc = {
  listVenues:     vi.fn(async () => ({ data: [], pagination: {} })),
  getVenue:       vi.fn(async () => ({ id: 'v1' })),
  reviewVenue:    vi.fn(async () => undefined),
  listActivities: vi.fn(async () => ({ data: [], pagination: {} })),
  getActivity:    vi.fn(async () => ({ id: 'a1' })),
  reviewActivity: vi.fn(async () => undefined),
};
const er = {
  getHealth:      vi.fn(async () => ({ status: 'ok' })),
  listQueue:      vi.fn(async () => ({ data: [], pagination: {} })),
  getStats:       vi.fn(async () => ({})),
  listCandidates: vi.fn(async () => []),
  accept:         vi.fn(async () => undefined),
  override:       vi.fn(async () => undefined),
  proposeNew:     vi.fn(async () => undefined),
};
const runRepo = { list: vi.fn(async () => []) };
const statsRepo = { getPlatformStats: vi.fn(async () => ({})) };

let publicJwk: JsonWebKey;
const jwksFetch = vi.fn(async (url: string | URL | Request) => {
  if (String(url) === `${ISSUER}/.well-known/jwks.json`) {
    return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] }), { status: 200 });
  }
  throw new Error(`fetch inesperado no teste: ${String(url)}`);
});

const deps = {
  corsOrigin:    ['http://localhost:5173'],
  reviewService: svc as unknown as ReviewService,
  erService:     er as unknown as EntityResolutionService,
  runRepo:       runRepo as unknown as IIngestionRunReadRepository,
  statsRepo:     statsRepo as unknown as StatsRepository,
  requestLogging: false,
};
const app = createApp({
  ...deps,
  jwtVerifier: createJwtVerifier({ supabaseUrl: SUPABASE_URL, fetchImpl: jwksFetch as unknown as typeof fetch, logger: silentLog }),
});

async function call(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const allServiceMocks = () => [...Object.values(svc), ...Object.values(er), runRepo.list, statsRepo.getPlatformStats];

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const other = (await crypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  signingKey = pair.privateKey;
  foreignKey = other.privateKey;
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  // Nenhum fetch real: o verificador usa jwksFetch; o global falha se for chamado.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new Error(`fetch global inesperado: ${String(url)}`); }));
});
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(() => { allServiceMocks().forEach((m) => m.mockClear()); });

// ── resolveAuthUser (função pura) ───────────────────────────────────────────

describe('resolveAuthUser', () => {
  it.each(['viewer', 'reviewer', 'admin'] as const)('aceita app_metadata.role=%s', (role) => {
    expect(resolveAuthUser(baseClaims({ app_metadata: { role } }))).toEqual({
      id: 'user-123', email: 'tester@example.test', role,
    });
  });

  it.each([
    ['sem app_metadata',              baseClaims()],
    ['app_metadata sem role',         baseClaims({ app_metadata: {} })],
    ['role null',                     baseClaims({ app_metadata: { role: null } })],
    ['role vazio',                    baseClaims({ app_metadata: { role: '' } })],
    ['role inválido',                 baseClaims({ app_metadata: { role: 'superuser' } })],
    ['role com maiúsculas',           baseClaims({ app_metadata: { role: 'Admin' } })],
    ['role não-string',               baseClaims({ app_metadata: { role: ['admin'] } })],
    ['role só em user_metadata',      baseClaims({ user_metadata: { role: 'admin' } })],
    ['role no topo (claim do Postgres)', baseClaims({ role: 'authenticated' })],
    ['app_metadata não-objecto',      baseClaims({ app_metadata: 'admin' })],
    ['anónimo com papel',             baseClaims({ is_anonymous: true, app_metadata: { role: 'admin' } })],
    ['sem sub',                       { exp: nowSec() + 60, app_metadata: { role: 'admin' } }],
  ])('rejeita: %s', (_label, payload) => {
    expect(resolveAuthUser(payload as Record<string, unknown>)).toBeNull();
  });

  it('is_anonymous=false com papel válido é aceite', () => {
    expect(resolveAuthUser(baseClaims({ is_anonymous: false, app_metadata: { role: 'viewer' } }))?.role).toBe('viewer');
  });
});

// ── Autenticação (401) e papel obrigatório (403) ────────────────────────────

describe('authMiddleware', () => {
  it('/health continua público', async () => {
    const res = await call('GET', '/health');
    expect(res.status).toBe(200);
  });

  it('sem Authorization → 401', async () => {
    expect((await call('GET', '/api/venues')).status).toBe(401);
  });

  it('Authorization sem Bearer → 401', async () => {
    const res = await app.request('/api/venues', { headers: { Authorization: 'Basic abc' } });
    expect(res.status).toBe(401);
  });

  it('token mal formado → 401', async () => {
    expect((await call('GET', '/api/venues', 'nao-e-um-jwt')).status).toBe(401);
  });

  it('assinatura de outra chave → 401', async () => {
    const t = await sign(baseClaims({ app_metadata: { role: 'admin' } }), foreignKey);
    expect((await call('GET', '/api/venues', t)).status).toBe(401);
  });

  it('payload adulterado depois de assinado (viewer → admin) → 401', async () => {
    const t = await tokenFor('viewer');
    const [h, , s] = t.split('.');
    const forged = `${h}.${b64urlJson(baseClaims({ app_metadata: { role: 'admin' } }))}.${s}`;
    expect((await call('PATCH', '/api/venues/v1/promote', forged)).status).toBe(401);
    expect(svc.reviewVenue).not.toHaveBeenCalled();
  });

  it('token expirado → 401', async () => {
    // SEC-B: há 30 s de tolerância de relógio; expirado há 60 s fica fora dela.
    const t = await sign(baseClaims({ exp: nowSec() - 60, app_metadata: { role: 'admin' } }));
    expect((await call('GET', '/api/venues', t)).status).toBe(401);
  });

  it('token sem exp → 401', async () => {
    const claims: Record<string, unknown> = baseClaims({ app_metadata: { role: 'admin' } });
    delete claims['exp'];
    expect((await call('GET', '/api/venues', await sign(claims))).status).toBe(401);
  });

  it('exp não numérico → 401', async () => {
    const t = await sign(baseClaims({ exp: 'never', app_metadata: { role: 'admin' } }));
    expect((await call('GET', '/api/venues', t)).status).toBe(401);
  });

  it.each([
    ['sem papel',              () => sign(baseClaims())],
    ['papel inválido',         () => tokenFor('superuser')],
    ['papel só em user_metadata', () => sign(baseClaims({ user_metadata: { role: 'admin' } }))],
    ['sessão anónima',         () => sign(baseClaims({ is_anonymous: true, app_metadata: { role: 'viewer' } }))],
  ])('token válido mas %s → 403, serviço não é chamado', async (_label, make) => {
    const res = await call('GET', '/api/venues', await make());
    expect(res.status).toBe(403);
    expect(svc.listVenues).not.toHaveBeenCalled();
  });

  it.each(['viewer', 'reviewer', 'admin'] as const)('papel %s lê /api/venues', async (role) => {
    expect((await call('GET', '/api/venues', await tokenFor(role))).status).toBe(200);
  });
});

// ── SEC-B: claims do Supabase e resposta genérica ──────────────────────────

describe('SEC-B — validação de JWT na app', () => {
  const admin = { app_metadata: { role: 'admin' } };

  it.each([
    ['sem kid',                     () => sign(baseClaims(admin), signingKey, { alg: 'ES256', typ: 'JWT' })],
    ['kid desconhecido',            () => sign(baseClaims(admin), signingKey, { alg: 'ES256', typ: 'JWT', kid: 'forjado' })],
    ['alg none',                    async () => `${b64urlJson({ alg: 'none', kid: KID })}.${b64urlJson(baseClaims(admin))}.`],
    ['iss de outro projecto',       () => sign(baseClaims({ ...admin, iss: 'https://outro.supabase.co/auth/v1' }))],
    ['iss ausente',                 () => sign(baseClaims({ ...admin, iss: undefined }))],
    ['aud anon',                    () => sign(baseClaims({ ...admin, aud: 'anon' }))],
    ['aud ausente',                 () => sign(baseClaims({ ...admin, aud: undefined }))],
    ['role top-level anon',         () => sign(baseClaims({ ...admin, role: 'anon' }))],
    ['role top-level service_role', () => sign(baseClaims({ ...admin, role: 'service_role' }))],
    ['nbf no futuro',               () => sign(baseClaims({ ...admin, nbf: nowSec() + 600 }))],
  ])('%s → 401 com mensagem genérica, sem motivo no corpo', async (_label, make) => {
    const res = await call('GET', '/api/venues', await make());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Token inválido ou expirado' });
    expect(svc.listVenues).not.toHaveBeenCalled();
  });

  it('nenhum fetch fora do JWKS do projecto', () => {
    expect(jwksFetch).toHaveBeenCalled();
    for (const [url] of jwksFetch.mock.calls) expect(String(url)).toBe(`${ISSUER}/.well-known/jwks.json`);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('createApp sem verificador e sem SUPABASE_URL → recusa pela configuração (401, sem fetch, log error)', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fetchCallsBefore = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    try {
      const bare = createApp(deps);
      const res = await bare.request('/api/venues', { headers: { Authorization: `Bearer ${await tokenFor('admin')}` } });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Token inválido ou expirado' });
      expect(svc.listVenues).not.toHaveBeenCalled();
      // Prova o caminho de configuração: nenhum verificador foi criado (nenhum
      // fetch de JWKS) e a falha de configuração foi registada.
      expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsBefore);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]?.[1])).toMatch(/configuração JWT inválida/);
      expect(warnSpy).toHaveBeenCalledWith({ reason: 'jwks_unavailable', kid: undefined }, 'SEC-B: JWT recusado');
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('log de rejeição contém só reason e kid (nunca token, claims ou email)', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const secretEmail = 'segredo.pessoal@example.test';
      const tokens = [
        await sign(baseClaims({ email: secretEmail, aud: 'anon', app_metadata: { role: 'admin' } })),
        await sign(baseClaims({ email: secretEmail, app_metadata: { role: 'admin' } }), foreignKey),
        await sign(baseClaims({ email: secretEmail, app_metadata: { role: 'admin' } }), signingKey, { alg: 'ES256', kid: 'forjado' }),
      ];
      for (const t of tokens) expect((await call('GET', '/api/venues', t)).status).toBe(401);
      expect(warnSpy).toHaveBeenCalledTimes(tokens.length);
      for (const [obj, msg] of warnSpy.mock.calls as unknown as Array<[Record<string, unknown>, string]>) {
        expect(Object.keys(obj).sort()).toEqual(['kid', 'reason']);
        expect(msg).toBe('SEC-B: JWT recusado');
        const logged = JSON.stringify([obj, msg]);
        expect(logged).not.toContain(secretEmail);
        expect(logged).not.toContain('user-123');
        for (const t of tokens) for (const seg of t.split('.')) expect(logged).not.toContain(seg);
      }
      expect(warnSpy.mock.calls.map(([o]) => (o as { reason: string }).reason)).toEqual(['aud', 'signature', 'kid']);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ── Todas as rotas GET ──────────────────────────────────────────────────────

const GET_ROUTES = [
  '/api/venues',
  '/api/venues/v1',
  '/api/activities',
  '/api/activities/a1',
  '/api/ingestion-runs',
  '/api/stats?product_key=vivere-60-mais',
  '/api/entity-resolution/health?product_key=vivere-60-mais',
  '/api/entity-resolution/queue?product_key=vivere-60-mais',
  '/api/entity-resolution/stats?product_key=vivere-60-mais',
  '/api/entity-resolution/a1/candidates',
];

describe('rotas GET', () => {
  it.each(GET_ROUTES)('%s: sem token 401, sem papel 403, viewer/reviewer/admin 200', async (path) => {
    expect((await call('GET', path)).status).toBe(401);
    expect((await call('GET', path, await sign(baseClaims()))).status).toBe(403);
    expect(allServiceMocks().some((m) => m.mock.calls.length > 0)).toBe(false);
    for (const role of ['viewer', 'reviewer', 'admin'] as const) {
      expect((await call('GET', path, await tokenFor(role))).status).toBe(200);
    }
  });
});

// ── Todas as rotas PATCH, por papel ─────────────────────────────────────────

const ROLES: readonly UserRole[] = ['viewer', 'reviewer', 'admin'];

const PATCH_CASES: Array<{ path: string; allowed: UserRole[]; mock: ReturnType<typeof vi.fn>; body?: unknown }> = [
  { path: '/api/venues/v1/approve',     allowed: ['reviewer', 'admin'], mock: svc.reviewVenue },
  { path: '/api/venues/v1/reject',      allowed: ['reviewer', 'admin'], mock: svc.reviewVenue },
  { path: '/api/venues/v1/promote',     allowed: ['admin'],             mock: svc.reviewVenue },
  { path: '/api/activities/a1/approve', allowed: ['reviewer', 'admin'], mock: svc.reviewActivity },
  { path: '/api/activities/a1/reject',  allowed: ['reviewer', 'admin'], mock: svc.reviewActivity },
  { path: '/api/activities/a1/promote', allowed: ['admin'],             mock: svc.reviewActivity },
  { path: '/api/entity-resolution/a1/accept',      allowed: ['reviewer', 'admin'], mock: er.accept,     body: { candidateId: 'c1' } },
  { path: '/api/entity-resolution/a1/override',    allowed: ['reviewer', 'admin'], mock: er.override,   body: { candidateId: 'c1', notes: 'n' } },
  { path: '/api/entity-resolution/a1/propose-new', allowed: ['admin'],             mock: er.proposeNew, body: {} },
];

describe('rotas PATCH', () => {
  for (const { path, allowed, mock, body } of PATCH_CASES) {
    it(`${path}: sem token 401, sem papel 403`, async () => {
      expect((await call('PATCH', path, undefined, body)).status).toBe(401);
      expect((await call('PATCH', path, await sign(baseClaims()), body)).status).toBe(403);
      expect(mock).not.toHaveBeenCalled();
    });

    for (const role of ROLES) {
      const ok = allowed.includes(role);
      it(`${path}: ${role} → ${ok ? '200' : '403 (serviço não é chamado)'}`, async () => {
        const res = await call('PATCH', path, await tokenFor(role), body);
        expect(res.status).toBe(ok ? 200 : 403);
        expect(mock).toHaveBeenCalledTimes(ok ? 1 : 0);
      });
    }
  }
});

// ── A matriz cobre todas as rotas de escrita ────────────────────────────────

describe('matriz de permissões', () => {
  const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  it('cada rota de escrita registada tem entrada na matriz', () => {
    const matrixPaths = new Set(MUTATION_ROLE_MATRIX.map((m) => `${m.method} ${m.path}`));
    const writeRoutes = app.routes.filter((r) => WRITE.has(r.method));
    expect(writeRoutes.length).toBeGreaterThan(0);
    for (const r of writeRoutes) {
      expect(matrixPaths, `${r.method} ${r.path} sem papel definido`).toContain(`${r.method} ${r.path}`);
    }
  });

  it('cada entrada da matriz corresponde a um handler real (sem caminhos órfãos)', () => {
    for (const m of MUTATION_ROLE_MATRIX) {
      const n = app.routes.filter((r) => r.method === m.method && r.path === m.path).length;
      expect(n, `${m.method} ${m.path}`).toBeGreaterThanOrEqual(2); // guarda + handler
    }
  });

  it('a matriz coincide com os casos testados (mesmas rotas, mesmos papéis)', () => {
    const toPattern = (p: string) => p
      .replace(/^\/api\/(venues|activities)\/[^/]+\//, '/api/$1/:id/')
      .replace(/^\/api\/entity-resolution\/[^/]+\//, '/api/entity-resolution/:activityId/');
    const fromCases = PATCH_CASES.map((c) => `${toPattern(c.path)} ${[...c.allowed].sort().join(',')}`).sort();
    const fromMatrix = MUTATION_ROLE_MATRIX.map((m) => `${m.path} ${[...m.roles].sort().join(',')}`).sort();
    expect(fromMatrix).toEqual(fromCases);
  });
});

// ── SEC-A-003: superfície completa e variações de caminho ──────────────────

describe('superfície /api/* e variações de caminho', () => {
  it('fora de /api/* só existe /health (nenhuma rota escapa ao authMiddleware)', () => {
    const outside = app.routes
      .filter((r) => r.path !== '/*' && !r.path.startsWith('/api/'))
      .map((r) => `${r.method} ${r.path}`);
    expect([...new Set(outside)]).toEqual(['GET /health']);
  });

  it('cada rota /api/* tem authMiddleware e requireRole(viewer+) registados antes', () => {
    const guards = app.routes.filter((r) => r.method === 'ALL' && r.path === '/api/*');
    expect(guards.length).toBe(2); // authMiddleware + requireRole(...VALID_ROLES)
    const firstHandler = app.routes.findIndex((r) => r.method !== 'ALL' && r.path.startsWith('/api/'));
    const lastGuard = app.routes.lastIndexOf(guards[guards.length - 1]);
    expect(lastGuard).toBeLessThan(firstHandler);
  });

  it.each([
    '/api/venues/v1/promote/',
    '/api//venues/v1/promote',
    '/api/venues/v1//promote',
    '/api/VENUES/v1/promote',
    '/api/venues/v1/PROMOTE',
    '/api/venues/v1/%70romote',
    '/api/venues/v1/promote?x=1',
    '/api/venues/v1/promote#x',
    '/api/entity-resolution/a1/propose-new/',
    '/api/entity-resolution/a1/%70ropose-new',
  ])('viewer não chega ao serviço por %s', async (path) => {
    const res = await call('PATCH', path, await tokenFor('viewer'), {});
    expect([403, 404]).toContain(res.status);
    expect(svc.reviewVenue).not.toHaveBeenCalled();
    expect(er.proposeNew).not.toHaveBeenCalled();
  });

  it('HEAD e OPTIONS sem token não devolvem dados', async () => {
    expect((await call('HEAD', '/api/venues')).status).toBe(401);
    const pre = await app.request('/api/venues', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    });
    expect(pre.status).toBe(204); // preflight CORS, como antes
    expect(svc.listVenues).not.toHaveBeenCalled();
  });

  it('a matriz usa exactamente ACTION_ROLES e ER_ACTION_ROLES (sem cópias)', async () => {
    const { ACTION_ROLES } = await import('../types/reviewTypes');
    const { ER_ACTION_ROLES } = await import('../services/EntityResolutionService');
    const byPath = new Map(MUTATION_ROLE_MATRIX.map((m) => [m.path, m.roles]));
    for (const a of ['approve', 'reject', 'promote'] as const) {
      expect(byPath.get(`/api/venues/:id/${a}`)).toBe(ACTION_ROLES[a]);
      expect(byPath.get(`/api/activities/:id/${a}`)).toBe(ACTION_ROLES[a]);
    }
    expect(byPath.get('/api/entity-resolution/:activityId/accept')).toBe(ER_ACTION_ROLES.accept);
    expect(byPath.get('/api/entity-resolution/:activityId/override')).toBe(ER_ACTION_ROLES.override);
    expect(byPath.get('/api/entity-resolution/:activityId/propose-new')).toBe(ER_ACTION_ROLES.proposeNew);
  });
});
