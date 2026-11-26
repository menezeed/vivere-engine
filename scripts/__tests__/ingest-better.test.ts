/**
 * scripts/ingest-better.ts: guardas do modo de escrita e dry-run sem BD nem rede.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../ingest-better';
import { BETTER_CONFIG } from '../../src/collectors/openactive-better/config';

const created: string[] = [];
afterEach(() => { for (const f of created.splice(0)) unlinkSync(f); vi.restoreAllMocks(); });

function snapshotFile(feedComplete = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-better-'));
  const file = join(dir, 'snap.json');
  const sched = { by_day: ['monday'], start_time: '09:30', end_time: '10:25', repeat_frequency: 'P1W', start_date: null, end_date: null, except_dates: [], timezone: 'Europe/London' };
  writeFileSync(file, JSON.stringify({
    gerado_em: '2026-11-26T12:00:00.000Z', hoje: '2026-11-26', dry_run: true, escrita_em_bd: false,
    fonte: { source_key: BETTER_CONFIG.source_key, feed_url: BETTER_CONFIG.feed_url, pedidos_http: 6, feed_completo: feedComplete },
    produto: BETTER_CONFIG.product_key,
    series: [
      { identifier: '1', rpde_modified: null, name: 'Swim for 60+', url: null, activities: ['Swimming'], age_range: { min: 60, max: null }, offers: [],
        location: { name: 'Pools on the Park', street: null, locality: 'Richmond', postcode: 'TW9 2SF' }, schedules: [sched] },
      { identifier: '2', rpde_modified: null, name: 'Group Cycle', url: null, activities: ['Indoor Cycling'], age_range: { min: 16, max: 110 },
        offers: [{ name: 'Adult', price: 11.7, currency: 'GBP', age_min: null, age_max: null }],
        location: { name: 'Teddington Pools and Fitness Centre', street: null, locality: 'Teddington', postcode: 'TW11 8EZ' }, schedules: [{ ...sched, end_date: '2026-06-01' }] },
    ],
  }));
  created.push(file);
  return file;
}

describe('ingest-better', () => {
  it('--apply sem --confirm=staging é recusado antes de qualquer leitura', async () => {
    await expect(main(['node', 'x', '--snapshot=/nao/existe.json', '--apply'])).rejects.toThrow(/confirm=staging/);
    await expect(main(['node', 'x', '--snapshot=/nao/existe.json', '--apply', '--confirm=prod'])).rejects.toThrow(/confirm=staging/);
  });

  it('sem --snapshot é recusado (não há recolha nova)', async () => {
    await expect(main(['node', 'x'])).rejects.toThrow(/--snapshot/);
  });

  it('--apply com feed incompleto é recusado antes de abrir a BD', async () => {
    const snap = snapshotFile(false);
    await expect(main(['node', 'x', `--snapshot=${snap}`, '--apply', '--confirm=staging'])).rejects.toThrow(/incompleto/);
  });

  it('dry-run: sem fetch, sem BD; relatório com as linhas previstas', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const snap = snapshotFile();
    const report = `${snap}.out.json`;
    await main(['node', 'x', `--snapshot=${snap}`, '--today=2026-11-26', `--report=${report}`]);
    created.push(report);
    expect(fetchSpy).not.toHaveBeenCalled();
    const r = JSON.parse(readFileSync(report, 'utf8'));
    expect(r.modo).toMatch(/DRY-RUN/);
    expect(r.escrita_efetuada).toBe(false);
    expect(r.linhas_gravadas).toBe(0);
    expect(r.contagens.a_inserir).toBe(1);
    expect(r.contagens.expiradas).toBe(1);
    expect(r.contagens.ocorrencias_a_inserir).toBe(3);
    expect(r.contagens.proposta_elegibilidade).toEqual({ confirmed_60plus: 1 });
    expect(r.insercoes[0].recorrencia_detectada.recurrence_type).toBe('weekly');
    expect(r.snapshot.pedidos_http_nesta_execucao).toBe(0);
  });
});
