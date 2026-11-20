import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/persistence/client/supabase', () => ({
  getSupabaseClient: vi.fn(() => {
    throw new Error('não pode ser chamado');
  }),
  _resetSupabaseClient: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => { throw new Error('não pode ser chamado'); }) }));

import { parseRunAssistedArgs } from '../run-assisted';

describe('parseRunAssistedArgs', () => {
  it('lê região, fontes repetidas e flags', () => {
    expect(parseRunAssistedArgs(['--region', 'cabo_frio', '--source', 'prefeitura_cabo_frio', '--source=x', '--since-days=30', '--dry-run', '--preflight', '--allow-paid', '--force-rerun'])).toEqual({
      region: 'cabo_frio',
      sources: ['prefeitura_cabo_frio', 'x'],
      sinceDays: 30,
      dryRun: true,
      preflightOnly: true,
      allowPaid: true,
      forceRerun: true,
    });
  });

  it('sem flags: execução real, sem preflight-only', () => {
    expect(parseRunAssistedArgs(['--region=buzios'])).toMatchObject({ region: 'buzios', sources: [], dryRun: false, preflightOnly: false, allowPaid: false, forceRerun: false });
  });

  it.each([[[]], [['--region']], [['--region', 'x', '--since-days=0']], [['--region', 'x', '--bogus']], [['--region', 'x', '--source']]])('recusa %j', (argv) => {
    expect(() => parseRunAssistedArgs(argv)).toThrow();
  });
});
