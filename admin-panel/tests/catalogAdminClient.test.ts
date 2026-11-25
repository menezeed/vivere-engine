import { expect, it, vi } from 'vitest';
import { catalogError, createCatalogClient } from '../src/catalog/client';
import { ApiError } from '../src/api/client';

const filters = { page: 2, search: ' feira & arte ', category: 'cultura', status: 'active', venueId: 'fixture-venue' } as const;
const environment = { target: 'fixture', access: 'read-only', label: 'DADOS SINTÉTICOS — SOMENTE LEITURA' };
const id = '00000000-0000-4000-8000-000000000001';

it('encodes filters and sends every request as fixture-only GET', async () => {
  const request = vi.fn(async <T,>(): Promise<T> => ({ environment }) as T);
  const client = createCatalogClient(request);
  const signal = new AbortController().signal;
  await client.list('activities', filters, signal);
  await client.list('venues', filters);
  await client.detail('activities', id);
  await client.categories();
  expect(request.mock.calls).toHaveLength(4);
  expect(request).toHaveBeenNthCalledWith(1,
    '/api/catalog/activities?page=2&pageSize=25&search=feira+%26+arte&category=cultura&engine_status=active&venue_id=fixture-venue&expected_target=fixture',
    { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
  expect(request).toHaveBeenNthCalledWith(2, expect.stringMatching(/engine_status=active&expected_target=fixture$/), expect.anything());
  expect(request).toHaveBeenNthCalledWith(3, `/api/catalog/activities/${id}?expected_target=fixture`, expect.anything());
  expect(request).toHaveBeenNthCalledWith(4, '/api/catalog/categories?expected_target=fixture', expect.anything());
  expect(() => client.detail('activities', '../../venues')).toThrow(ApiError);
});

it('rejects a response without the exact fixture environment', async () => {
  const client = createCatalogClient(async <T,>() => ({ environment: { ...environment, target: 'production' } }) as T);
  await expect(client.list('activities', filters)).rejects.toMatchObject({ status: 503 });
});

it.each([
  [400, 'Revise os filtros'], [401, 'Inicie sessão'], [403, 'não tem permissão'],
  [404, 'Registro indisponível'], [502, 'Catálogo indisponível'], [503, 'Catálogo sintético desativado'],
])('maps status %i to a safe message', (status, message) => {
  expect(catalogError(new ApiError(status, { error: 'internal details' }))).toContain(message);
  expect(catalogError(new ApiError(status, { error: 'internal details' }))).not.toContain('internal details');
});
