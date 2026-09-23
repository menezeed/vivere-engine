/**
 * scripts/__tests__/ingest-wordpress-content.test.ts
 *
 * Teste mínimo (Level 2, 2026-09-23) — São Pedro da Aldeia Simple
 * Enablement. Confirma só a resolução de AVAILABLE_INSTANCES: zero rede,
 * zero Supabase (RepositoryFactory.forSupabase() nunca é chamado por
 * este teste, porque main() está protegido por import.meta.url e nunca
 * corre ao importar o módulo).
 */

import { describe, it, expect } from 'vitest';
import { AVAILABLE_INSTANCES } from '../ingest-wordpress-content.js';

describe('ingest-wordpress-content — AVAILABLE_INSTANCES', () => {
  it('cabo-frio continua registada e resolve correctamente (regressão)', () => {
    const config = AVAILABLE_INSTANCES['cabo-frio'];
    expect(config).toBeDefined();
    expect(config!.source_key).toBe('prefeitura_cabo_frio');
    expect(config!.product_key).toBe('vivere-60-mais');
  });

  it('sao-pedro-da-aldeia está registada e resolve para source_key/product_key correctos', () => {
    const config = AVAILABLE_INSTANCES['sao-pedro-da-aldeia'];
    expect(config).toBeDefined();
    expect(config!.source_key).toBe('prefeitura_sao_pedro_da_aldeia');
    expect(config!.product_key).toBe('vivere-60-mais');
  });

  it('instância desconhecida não está registada', () => {
    expect(AVAILABLE_INSTANCES['instancia-inexistente']).toBeUndefined();
  });
});
