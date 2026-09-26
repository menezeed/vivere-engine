/**
 * entity-resolution/pipeline/__tests__/WordPressSourceTerritorialContextProvider.test.ts
 *
 * Level 2, 2026-09-26 — casos L/M aprovados.
 */

import { describe, it, expect } from 'vitest';
import { WordPressSourceTerritorialContextProvider } from '../WordPressSourceTerritorialContextProvider';

const provider = new WordPressSourceTerritorialContextProvider();

describe('WordPressSourceTerritorialContextProvider', () => {
  it('L. source com region_metadata → contexto territorial correcto (Cabo Frio, caso real)', () => {
    const context = provider.getCityContext('prefeitura_cabo_frio');
    expect(context).toEqual({ city: 'Cabo Frio', state: 'RJ' });
  });

  it('L. source com region_metadata → contexto territorial correcto (São Pedro da Aldeia)', () => {
    const context = provider.getCityContext('prefeitura_sao_pedro_da_aldeia');
    expect(context).not.toBeNull();
    expect(context!.state).toBe('RJ');
  });

  it('M. source_key desconhecido → null', () => {
    expect(provider.getCityContext('fonte-que-nao-existe')).toBeNull();
  });
});
