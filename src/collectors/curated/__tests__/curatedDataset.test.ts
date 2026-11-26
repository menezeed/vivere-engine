/**
 * Curadoria manual 60+ (piloto UK). Sem rede.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCuratedDataset, planFromCurated, occurrencesFor, recurrenceHint, type CuratedDataset } from '../curatedDataset';
import { main } from '../../../../scripts/ingest-curated';

const REAL = JSON.parse(readFileSync(new URL('../richmond-curated-60plus.v1.json', import.meta.url), 'utf8')) as CuratedDataset;
const clone = (): CuratedDataset => JSON.parse(JSON.stringify(REAL));

afterEach(() => vi.restoreAllMocks());

describe('parseCuratedDataset', () => {
  it('aceita o dataset versionado', () => {
    expect(parseCuratedDataset(clone()).items).toHaveLength(5);
  });
  it.each([
    ['URL fora do site oficial', (d: CuratedDataset) => { d.items[0]!.url = 'https://evil.example/x'; }, /site oficial/],
    ['URL com query', (d: CuratedDataset) => { d.items[0]!.url += '?x=1'; }, /query/],
    ['sem sinal 60+', (d: CuratedDataset) => { const i = d.items[0]!; i.organised_by_org = false; i.explicit_60plus_quote = null; i.audience_snippets = []; }, /regra de inclusão/],
    ['telefone num campo', (d: CuratedDataset) => { d.items[0]!.cost_text = 'call 020 8876 0000'; }, /dados pessoais/],
    ['e-mail num campo', (d: CuratedDataset) => { d.items[0]!.venue.address = 'x@y.org'; }, /dados pessoais/],
    ['código postal inválido', (d: CuratedDataset) => { d.items[0]!.venue.postcode = 'TW12'; }, /código postal/],
    ['hora inválida', (d: CuratedDataset) => { d.items[0]!.schedule.start = '25:00'; }, /hora/],
    ['inscrição desconhecida', (d: CuratedDataset) => { (d.items[0] as { booking: string }).booking = 'x'; }, /inscrição/],
    ['id repetido', (d: CuratedDataset) => { d.items[1]!.id = d.items[0]!.id; d.items[1]!.source = d.items[0]!.source; }, /repetido/],
    ['organização desconhecida', (d: CuratedDataset) => { d.items[0]!.source = 'nope_org'; }, /desconhecida/],
    ['produto errado', (d: CuratedDataset) => { d.product = 'vivere-60-mais'; }, /produto/],
  ])('%s → recusa', (_n, mutate, err) => {
    const d = clone(); mutate(d);
    expect(() => parseCuratedDataset(d)).toThrow(err);
  });
});

describe('ocorrências e recorrência declarada', () => {
  it('semanal: todas as quintas na janela (inclui hoje)', () => {
    const o = occurrencesFor({ type: 'weekly', days: ['thu'], start: '13:30', end: '15:15' }, '2026-11-26', 14);
    expect(o.map(x => x.date)).toEqual(['2026-11-26', '2026-12-03', '2026-12-10']);
    expect(o[0]).toEqual({ date: '2026-11-26', time: '13:30', end_date: null, end_time: '15:15' });
  });
  it('mensal: segunda quarta-feira do mês', () => {
    const o = occurrencesFor({ type: 'monthly_nth', days: ['wed'], nth: 2, start: '14:30', end: '15:30' }, '2026-11-26', 62);
    expect(o.map(x => x.date)).toEqual(['2026-12-09', '2027-01-13']);
  });
  it('texto de recorrência', () => {
    expect(recurrenceHint({ type: 'weekly', days: ['thu'], start: '13:30', end: null })).toBe('Every Thursday');
    expect(recurrenceHint({ type: 'monthly_nth', days: ['wed'], nth: 2, start: '14:30', end: null })).toBe('Second Wednesday of each month');
  });
});

describe('planFromCurated (dataset real)', () => {
  const p = planFromCurated(parseCuratedDataset(clone()), '2026-11-26');
  const all = [...p.bySource.values()].flat();
  const cls = (t: string) => p.proposals.find(x => x.title === t)!.classification;

  it('4 actividades gravaveis (Greenwood); Cambrian Teas retida por obras (datas incertas)', () => {
    expect(all).toHaveLength(4);
    expect([...p.bySource.keys()]).toEqual(['greenwood_hhhvc']);
    expect(p.held).toHaveLength(1);
    expect(p.held[0]!.title).toBe('Cambrian Teas');
    expect(p.held[0]!.reason).toMatch(/Refurbishment/);
  });
  it('elegibilidade: 60+ explícito → confirmed; Parkinson → unclear; grupos da organização → likely', () => {
    expect(cls('FLexercise Over 60s')).toBe('confirmed_60plus');
    expect(cls("Parkinson's Exercise Class")).toBe('unclear');
    expect(cls("H&HHVC Women's Social Group")).toBe('likely_suitable');
    expect(p.proposals.every(x => x.confidence !== 'high')).toBe(true);
    expect(p.proposals.every(x => x.human_review_notes.some(n => /Curadoria manual/.test(n)))).toBe(true);
  });
  it('privacidade: sem descrição nem contactos; recorrência declarada', () => {
    for (const i of all) {
      expect(i.description).toBeNull();
      expect(i.contact_email).toBeNull();
      expect(i.contact_phone).toBeNull();
      expect(i.recurrence_text_hint).toMatch(/^(Every|Second)/);
    }
  });
});

describe('scripts/ingest-curated.ts', () => {
  it('--apply sem --confirm=staging é recusado', async () => {
    await expect(main(['node', 'x', '--apply'])).rejects.toThrow(/confirm=staging/);
  });
  it('dry-run: sem fetch e sem BD', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['node', 'x', '--today=2026-11-26']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.mock.calls[0]![0]).toMatch(/NADA FOI GRAVADO/);
  });
});
