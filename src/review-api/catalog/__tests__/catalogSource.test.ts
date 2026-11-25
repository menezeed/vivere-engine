/**
 * Issue #52 — configuração e fonte do catálogo de produção (SÓ LEITURA).
 * Sem rede: o fetch é sempre falso e regista cada pedido.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveCatalogConfig, CatalogConfigError, CATALOG_VARS } from '../catalogConfig';
import { PostgrestCatalogSource, sanitizeSearch } from '../PostgrestCatalogSource';
import { activityCompleteness, venueCompleteness } from '../completeness';
import { FixtureCatalogSource } from '../FixtureCatalogSource';
import { CATALOG_ACCESS_LABEL, CatalogUpstreamError } from '../catalogTypes';

const PROD = 'https://ccpqngyupukdefaqvzgl.supabase.co';
const STG = 'https://jvtcgomwbfojsttepcfc.supabase.co';
const jwt = (claims: Record<string, unknown>) =>
  `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;
const ANON_PROD = jwt({ role: 'anon', ref: 'ccpqngyupukdefaqvzgl' });
const PUB = 'sb_publishable_AAAAAAAAAAAAAAAAAAAA';
const env = (extra: Record<string, string>) => ({ ...extra }) as NodeJS.ProcessEnv;
const prodEnv = (over: Record<string, string> = {}) => env({
  [CATALOG_VARS.mode]: 'production-readonly', [CATALOG_VARS.url]: PROD, [CATALOG_VARS.key]: PUB,
  [CATALOG_VARS.ack]: CATALOG_ACCESS_LABEL, ...over,
});

describe('resolveCatalogConfig (falha fechada)', () => {
  it('desligado por omissão', () => {
    expect(resolveCatalogConfig(env({}))).toEqual({ mode: 'disabled' });
    expect(resolveCatalogConfig(env({ [CATALOG_VARS.mode]: 'disabled' }))).toEqual({ mode: 'disabled' });
  });
  it('fixture não precisa de nada da produção', () => {
    expect(resolveCatalogConfig(env({ [CATALOG_VARS.mode]: 'fixture' }))).toEqual({ mode: 'fixture' });
  });
  it('production-readonly com publishable e com JWT anon de produção', () => {
    expect(resolveCatalogConfig(prodEnv()).mode).toBe('production-readonly');
    expect(resolveCatalogConfig(prodEnv({ [CATALOG_VARS.key]: ANON_PROD })).mode).toBe('production-readonly');
  });
  it.each([
    ['modo desconhecido', env({ [CATALOG_VARS.mode]: 'production' })],
    ['sem URL', prodEnv({ [CATALOG_VARS.url]: '' })],
    ['URL do staging', prodEnv({ [CATALOG_VARS.url]: STG })],
    ['URL com barra final', prodEnv({ [CATALOG_VARS.url]: `${PROD}/` })],
    ['URL de outro projecto', prodEnv({ [CATALOG_VARS.url]: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' })],
    ['sem chave', prodEnv({ [CATALOG_VARS.key]: '' })],
    ['chave secreta', prodEnv({ [CATALOG_VARS.key]: 'sb_secret_AAAAAAAAAAAAAAAAAAAA' })],
    ['JWT service_role', prodEnv({ [CATALOG_VARS.key]: jwt({ role: 'service_role', ref: 'ccpqngyupukdefaqvzgl' }) })],
    ['JWT anon do staging', prodEnv({ [CATALOG_VARS.key]: jwt({ role: 'anon', ref: 'jvtcgomwbfojsttepcfc' }) })],
    ['JWT authenticated', prodEnv({ [CATALOG_VARS.key]: jwt({ role: 'authenticated', ref: 'ccpqngyupukdefaqvzgl' }) })],
    ['chave com espaço', prodEnv({ [CATALOG_VARS.key]: `${PUB} ` })],
    ['sem aceite', prodEnv({ [CATALOG_VARS.ack]: '' })],
    ['aceite diferente', prodEnv({ [CATALOG_VARS.ack]: 'sim' })],
  ])('recusa: %s', (_l, e) => {
    expect(() => resolveCatalogConfig(e)).toThrow(CatalogConfigError);
  });
  it('as mensagens nunca contêm o valor da chave', () => {
    const secret = 'sb_secret_ZZZZZZZZZZZZZZZZZZZZ';
    try { resolveCatalogConfig(prodEnv({ [CATALOG_VARS.key]: secret })); } catch (e) {
      expect(String((e as Error).message)).not.toContain(secret);
    }
  });
});

function fakeFetch(rows: unknown[] = [], status = 200, total = 0) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(rows), { status, headers: { 'content-range': `0-${Math.max(0, rows.length - 1)}/${total}` } }));
}
const src = (f: ReturnType<typeof fakeFetch>, key = PUB) =>
  new PostgrestCatalogSource({ baseUrl: PROD, publishableKey: key, fetchImpl: f as unknown as typeof fetch });

describe('PostgrestCatalogSource (só GET, allowlist, sem token de utilizador)', () => {
  it('lista actividades com GET, colunas da allowlist, paginação e contagem', async () => {
    const f = fakeFetch([{ id: 'x' }], 206, 48);
    const r = await src(f).listActivities({ page: 2, pageSize: 10, sort: 'created_at', order: 'desc', search: 'yoga', category: 'cultura' });
    const [url, init] = f.mock.calls[0]!;
    const u = new URL(String(url));
    expect(init?.method).toBe('GET');
    expect(u.origin).toBe(PROD);
    expect(u.pathname).toBe('/rest/v1/activities');
    expect(u.searchParams.get('select')).toContain('venue:venues(id,name)');
    expect(u.searchParams.get('select')).not.toContain('*');
    expect(u.searchParams.get('title')).toBe('ilike.*yoga*');
    expect(u.searchParams.get('category')).toBe('eq.cultura');
    const h = init?.headers as Record<string, string>;
    expect(h['Range']).toBe('10-19');
    expect(h['apikey']).toBe(PUB);
    expect(h['Authorization']).toBeUndefined(); // publishable: nunca Authorization
    expect(r).toMatchObject({ page: 2, pageSize: 10, totalItems: 48, totalPages: 5 });
  });
  it('JWT anon legado vai também em Authorization (e é a única credencial)', async () => {
    const f = fakeFetch([]);
    await src(f, ANON_PROD).listVenues({ page: 1, pageSize: 25, sort: 'name', order: 'asc' });
    expect((f.mock.calls[0]![1]?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${ANON_PROD}`);
  });
  it('sanitiza a pesquisa (sem operadores do PostgREST)', () => {
    expect(sanitizeSearch('a*b,c).or(id.eq.1')).toBe('a b c or id eq 1');
    expect(sanitizeSearch('   ')).toBeUndefined();
    expect(sanitizeSearch('x'.repeat(200))?.length).toBe(80);
  });
  it('recusa venue_id que não é UUID e engine_status fora do enum, sem pedido', async () => {
    const f = fakeFetch();
    await expect(src(f).listActivities({ page: 1, pageSize: 5, sort: 'title', order: 'asc', venueId: '1 or 1=1' })).rejects.toBeInstanceOf(CatalogUpstreamError);
    await expect(src(f).listVenues({ page: 1, pageSize: 5, sort: 'name', order: 'asc', engineStatus: 'x' as never })).rejects.toBeInstanceOf(CatalogUpstreamError);
    expect(f).not.toHaveBeenCalled();
  });
  it('detalhe: id inválido devolve null sem pedido; inexistente devolve null', async () => {
    const f = fakeFetch([]);
    expect(await src(f).getActivity('nope')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(await src(f).getVenue('00000000-0000-4000-8000-0000000000a1')).toBeNull();
  });
  it('erro HTTP da produção vira CatalogUpstreamError', async () => {
    await expect(src(fakeFetch([], 500)).listCategories()).rejects.toBeInstanceOf(CatalogUpstreamError);
  });
  it('a classe não expõe nenhum método de escrita', () => {
    const proto = Object.getOwnPropertyNames(PostgrestCatalogSource.prototype);
    expect(proto.filter((m) => /create|insert|update|delete|patch|post|upsert|remove/i.test(m))).toEqual([]);
  });
});

describe('completude', () => {
  it('detecta lacunas da actividade de exemplo incompleta', async () => {
    const a = await new FixtureCatalogSource().getActivity('00000000-0000-4000-8000-000000000003');
    expect(activityCompleteness(a!, new Set(['cultura', 'esporte'])).missing)
      .toEqual(['category_unknown', 'venue', 'date_or_recurrence', 'price_or_free']);
  });
  it('recorrência completa substitui a data de início', async () => {
    const a = await new FixtureCatalogSource().getActivity('00000000-0000-4000-8000-000000000002');
    expect(activityCompleteness(a!).missing).toEqual(['price_or_free']);
  });
  it('local sem coordenadas, morada nem categoria', async () => {
    const v = await new FixtureCatalogSource().getVenue('00000000-0000-4000-8000-0000000000a2');
    expect(venueCompleteness(v!).missing).toEqual(['address', 'coordinates', 'category']);
  });
});
