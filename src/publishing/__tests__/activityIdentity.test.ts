/**
 * src/publishing/__tests__/activityIdentity.test.ts
 *
 * Golden-vector test (Level 3, 2026-09-23) — protege o contrato de
 * identidade contra mudanças acidentais no algoritmo, no namespace, ou na
 * codificação canónica do input. Se este teste falhar depois de qualquer
 * refactor, TODAS as activities já publicadas pela Engine (quando existirem)
 * mudariam de identidade — tratar como breaking change deliberado, nunca
 * como "só um teste desactualizado".
 */

import { describe, it, expect } from 'vitest';
import { deriveEngineActivityId } from '../services/activityIdentity.js';

describe('deriveEngineActivityId — golden vector', () => {
  it('produz sempre o mesmo UUID para (source_key, source_item_id) conhecidos', () => {
    // Vector fixo, calculado uma vez e nunca recalculado — se o algoritmo,
    // o namespace, ou a codificação do input mudarem, este teste falha.
    expect(deriveEngineActivityId('prefeitura_cabo_frio', '146007_0'))
      .toBe('7235d91b-a8d5-52fe-8645-4b6b41e09f43');
  });

  it('é um UUID v5 sintáticamente válido (versão 5, variante RFC 4122)', () => {
    const id = deriveEngineActivityId('prefeitura_cabo_frio', '146007_0');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe('deriveEngineActivityId — determinismo', () => {
  it('a mesma entrada produz sempre o mesmo resultado, chamada múltiplas vezes', () => {
    const a = deriveEngineActivityId('prefeitura_cabo_frio', '146007_0');
    const b = deriveEngineActivityId('prefeitura_cabo_frio', '146007_0');
    const c = deriveEngineActivityId('prefeitura_cabo_frio', '146007_0');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('deriveEngineActivityId — unicidade entre identidades diferentes', () => {
  it('source_item_id diferente → UUID diferente, mesmo source_key', () => {
    const a = deriveEngineActivityId('prefeitura_cabo_frio', '146007_0');
    const b = deriveEngineActivityId('prefeitura_cabo_frio', '146007_1');
    expect(a).not.toBe(b);
  });

  it('source_key diferente → UUID diferente, mesmo source_item_id', () => {
    const a = deriveEngineActivityId('prefeitura_cabo_frio', '146007_0');
    const b = deriveEngineActivityId('prefeitura_sao_pedro_da_aldeia', '146007_0');
    expect(a).not.toBe(b);
  });

  it('não há colisão num conjunto real de identidades observadas nesta sessão', () => {
    const identidadesReais: [string, string][] = [
      ['prefeitura_cabo_frio', '146007_0'],
      ['prefeitura_cabo_frio', '146007_1'],
      ['prefeitura_cabo_frio', '142791_0'],
      ['prefeitura_cabo_frio', '139789_0'],
      ['prefeitura_cabo_frio', '142861_0'],
      ['prefeitura_sao_pedro_da_aldeia', '146007_0'],
    ];
    const gerados = identidadesReais.map(([sk, si]) => deriveEngineActivityId(sk, si));
    const unicos = new Set(gerados);
    expect(unicos.size).toBe(gerados.length);
  });
});
