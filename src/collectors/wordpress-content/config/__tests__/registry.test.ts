/**
 * src/collectors/wordpress-content/config/__tests__/registry.test.ts
 *
 * Level 2, 2026-09-26 — Entity Resolution territorial context.
 *
 * ⚠ Se já existir um arquivo de teste com este nome, NÃO sobrescrever
 * cegamente — confirmar primeiro com Test-Path.
 */

import { describe, it, expect } from 'vitest';
import { AVAILABLE_INSTANCES, getWordPressSourceConfigBySourceKey, buildSourceKeyIndex } from '../registry';
import type { WordPressContentSourceConfig } from '../WordPressContentSourceConfig';

describe('registry — AVAILABLE_INSTANCES (H. instance keys existentes continuam funcionando)', () => {
  it('cabo-frio continua registada por instance key', () => {
    expect(AVAILABLE_INSTANCES['cabo-frio']).toBeDefined();
    expect(AVAILABLE_INSTANCES['cabo-frio']!.source_key).toBe('prefeitura_cabo_frio');
  });

  it('sao-pedro-da-aldeia continua registada por instance key', () => {
    expect(AVAILABLE_INSTANCES['sao-pedro-da-aldeia']).toBeDefined();
    expect(AVAILABLE_INSTANCES['sao-pedro-da-aldeia']!.source_key).toBe('prefeitura_sao_pedro_da_aldeia');
  });
});

describe('getWordPressSourceConfigBySourceKey — I/J. lookup derivada por source_key', () => {
  it('I. source_key conhecido → config correcta', () => {
    const config = getWordPressSourceConfigBySourceKey('prefeitura_cabo_frio');
    expect(config).not.toBeNull();
    expect(config!.display_name).toBe('Prefeitura de Cabo Frio');
  });

  it('J. source_key desconhecido → null', () => {
    expect(getWordPressSourceConfigBySourceKey('fonte-que-nao-existe')).toBeNull();
  });
});

describe('buildSourceKeyIndex — K. duplicate source_key falha explicitamente', () => {
  function fakeConfig(sourceKey: string): WordPressContentSourceConfig {
    return {
      source_key: sourceKey,
      display_name: 'Fake',
      product_key: 'vivere-60-mais',
      source_priority: 100,
      base_url: 'https://example.com',
      category_id: 1,
      since_days: 30,
      max_pages: 10,
      per_page: 20,
      delay_ms_between_pages: 300,
      structured_block_marker: /servico:?/i,
    };
  }

  it('duas instâncias com o mesmo source_key lançam, não escolhem silenciosamente a primeira', () => {
    const instances = {
      'instancia-a': fakeConfig('mesmo-source-key'),
      'instancia-b': fakeConfig('mesmo-source-key'),
    };
    expect(() => buildSourceKeyIndex(instances)).toThrow(/duplicado/i);
  });

  it('instâncias com source_key distintos não lançam', () => {
    const instances = {
      'instancia-a': fakeConfig('source-a'),
      'instancia-b': fakeConfig('source-b'),
    };
    expect(() => buildSourceKeyIndex(instances)).not.toThrow();
  });

  it('o registry real (AVAILABLE_INSTANCES) não tem duplicados — confirma que a produção está limpa', () => {
    expect(() => buildSourceKeyIndex(AVAILABLE_INSTANCES)).not.toThrow();
  });
});
