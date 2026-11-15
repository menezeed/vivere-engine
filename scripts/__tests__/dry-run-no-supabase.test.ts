/**
 * --dry-run dos scripts de ingestão NUNCA cria repositórios nem cliente
 * Supabase. O modo real continua a passar por RepositoryFactory.forSupabase
 * (→ getSupabaseClient → envGuard).
 *
 * Sem rede: o cliente WordPress e o cliente Google Places (API paga) são
 * substituídos por versões falsas; getSupabaseClient e createClient falham
 * se forem chamados.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const m = vi.hoisted(() => ({
  forSupabase: vi.fn(async () => {
    throw new Error('teste: RepositoryFactory.forSupabase() chamado');
  }),
  getSupabaseClient: vi.fn(() => {
    throw new Error('teste: getSupabaseClient() chamado');
  }),
  createClient: vi.fn(() => {
    throw new Error('teste: createClient() chamado');
  }),
  wpFetchPosts: vi.fn(async () => ({ posts: [], totalPages: 1 })),
  textSearch: vi.fn(async () => ({ places: [], costUsd: 0 })),
}));

vi.mock('../../src/persistence/orchestration/RepositoryFactory', () => ({
  RepositoryFactory: { forSupabase: m.forSupabase },
}));
vi.mock('../../src/persistence/client/supabase', () => ({ getSupabaseClient: m.getSupabaseClient, _resetSupabaseClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: m.createClient }));
vi.mock('../../src/collectors/wordpress-content/WordPressApiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/collectors/wordpress-content/WordPressApiClient')>();
  return {
    ...original,
    WordPressApiClient: class {
      fetchPosts = m.wpFetchPosts;
    },
  };
});
vi.mock('../../src/collectors/google-places/GooglePlacesApiClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/collectors/google-places/GooglePlacesApiClient')>();
  return {
    ...original,
    GooglePlacesApiClient: class {
      textSearch = m.textSearch;
      getEnrichedDetails = vi.fn(async () => ({ details: null, costUsd: 0 }));
    },
  };
});

import { main as ingestWordPressContent } from '../ingest-wordpress-content';
import { main as ingestGooglePlaces } from '../ingest-google-places';

const KEY = 'GOOGLE_PLACES_API_KEY';
let savedKey: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  savedKey = process.env[KEY];
  process.env[KEY] = 'chave-falsa-de-teste';
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY];
  else process.env[KEY] = savedKey;
  vi.restoreAllMocks();
});

describe('ingest-wordpress-content', () => {
  it('--dry-run não cria repositórios nem cliente Supabase', async () => {
    await ingestWordPressContent(['node', 'ingest-wordpress-content.ts', '--instance=cabo-frio', '--dry-run']);
    expect(m.wpFetchPosts).toHaveBeenCalled(); // a recolha correu
    expect(m.forSupabase).not.toHaveBeenCalled();
    expect(m.getSupabaseClient).not.toHaveBeenCalled();
    expect(m.createClient).not.toHaveBeenCalled();
  });

  it('modo real continua a passar por RepositoryFactory.forSupabase, antes de recolher', async () => {
    await expect(ingestWordPressContent(['node', 'ingest-wordpress-content.ts', '--instance=cabo-frio'])).rejects.toThrow(/forSupabase\(\) chamado/);
    expect(m.forSupabase).toHaveBeenCalledTimes(1);
    expect(m.wpFetchPosts).not.toHaveBeenCalled();
  });
});

describe('ingest-google-places', () => {
  it('--dry-run não cria repositórios nem cliente Supabase', async () => {
    await ingestGooglePlaces(['node', 'ingest-google-places.ts', '--region=cabo_frio', '--limit=1', '--dry-run']);
    expect(m.textSearch).toHaveBeenCalled(); // a recolha (falsa) correu
    expect(m.forSupabase).not.toHaveBeenCalled();
    expect(m.getSupabaseClient).not.toHaveBeenCalled();
    expect(m.createClient).not.toHaveBeenCalled();
  });

  it('modo real continua a passar por RepositoryFactory.forSupabase, antes de chamar a API paga', async () => {
    await expect(ingestGooglePlaces(['node', 'ingest-google-places.ts', '--region=cabo_frio', '--limit=1'])).rejects.toThrow(/forSupabase\(\) chamado/);
    expect(m.forSupabase).toHaveBeenCalledTimes(1);
    expect(m.textSearch).not.toHaveBeenCalled();
  });

  it('--budget=persistent usa o cliente único (getSupabaseClient) antes de qualquer chamada paga', async () => {
    await expect(
      ingestGooglePlaces(['node', 'ingest-google-places.ts', '--region=cabo_frio', '--limit=1', '--budget=persistent']),
    ).rejects.toThrow(/getSupabaseClient\(\) chamado/);
    expect(m.getSupabaseClient).toHaveBeenCalledTimes(1);
    expect(m.createClient).not.toHaveBeenCalled();
    expect(m.textSearch).not.toHaveBeenCalled();
  });

  it('--dry-run com orçamento por omissão (memory) não toca no Supabase nem no orçamento persistente', async () => {
    await ingestGooglePlaces(['node', 'ingest-google-places.ts', '--region=cabo_frio', '--limit=1', '--dry-run', '--budget=memory']);
    expect(m.getSupabaseClient).not.toHaveBeenCalled();
    expect(m.createClient).not.toHaveBeenCalled();
  });
});
