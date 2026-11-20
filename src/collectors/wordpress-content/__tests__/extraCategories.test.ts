import { afterEach, describe, expect, it, vi } from 'vitest';
import { WordPressApiClient, fetchPostsSince } from '../WordPressApiClient';
import { CABO_FRIO_CONFIG } from '../config/cabo-frio';

function mockFetch() {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    urls.push(u);
    return new Response('[]', { status: 200, headers: { 'X-WP-TotalPages': '1' } });
  }));
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe('categorias adicionais (extra_category_ids)', () => {
  it('sem extras: o pedido mantém só a categoria principal', async () => {
    const urls = mockFetch();
    await new WordPressApiClient('https://exemplo.invalid').fetchPosts({ categoryId: 73, page: 1, perPage: 20 });
    expect(new URL(urls[0]!).searchParams.get('categories')).toBe('73');
  });

  it('com extras: categories=principal,extras (OU na REST API)', async () => {
    const urls = mockFetch();
    await new WordPressApiClient('https://exemplo.invalid').fetchPosts({ categoryId: 73, extraCategoryIds: [4], page: 1, perPage: 20 });
    expect(new URL(urls[0]!).searchParams.get('categories')).toBe('73,4');
  });

  it('fetchPostsSince propaga os extras para cada página (2 páginas com posts na janela)', async () => {
    const urls: string[] = [];
    const post = (id: number) => ({ id, date: '2026-11-10T10:00:00', date_gmt: '2026-11-10T13:00:00', title: { rendered: 't' }, content: { rendered: '' }, link: '' });
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      const page = Number(new URL(u).searchParams.get('page'));
      return new Response(JSON.stringify([post(page)]), { status: 200, headers: { 'X-WP-TotalPages': '2' } });
    }));
    const gen = fetchPostsSince(new WordPressApiClient('https://exemplo.invalid'), {
      categoryId: 73, extraCategoryIds: [4], sinceDate: new Date('2026-01-01'), perPage: 20, maxPages: 5, delayMsBetweenPages: 0,
    });
    const pages: number[] = [];
    for await (const batch of gen) pages.push(...batch.map((p) => p.id));
    expect(pages).toEqual([1, 2]);
    expect(urls.map((u) => new URL(u).searchParams.get('page'))).toEqual(['1', '2']);
    for (const u of urls) expect(new URL(u).searchParams.get('categories')).toBe('73,4');
  });

  it('Cabo Frio recolhe Cultura (73) e Secretaria de Eventos (4)', () => {
    expect(CABO_FRIO_CONFIG.category_id).toBe(73);
    expect(CABO_FRIO_CONFIG.extra_category_ids).toEqual([4]);
  });
});
