/**
 * Piloto UK, fontes novas — colector FiSH (ICS). Só fixtures sintéticas: sem rede.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FishIcsCollector, seriesKey, observedRecurrence, dayOfWeek } from '../FishIcsCollector';
import { extractSignals, splitLocation, safeSentences } from '../fishText';
import { FISH_CONFIG } from '../config';

const ICS = readFileSync(new URL('./fixtures/fish-sample.ics', import.meta.url), 'utf8');
const TODAY = '2026-11-26';
const NOW = () => '2026-11-26T12:00:00.000Z';
const noFetch = vi.fn(async () => { throw new Error('sem rede nos testes'); });

function run() {
  return new FishIcsCollector(noFetch, TODAY, NOW).fromIcs(ICS);
}

describe('FishIcsCollector.fromIcs', () => {
  it('agrupa ocorrências em séries com chave estável e exclui com motivo', () => {
    const r = run();
    expect(r.events_read).toBe(8);
    expect(r.items.map(i => i.source_item_id)).toEqual([
      'series:chair-exercise-club:thu:1030',
      'series:christmas-fair:sat:allday',
      'series:coffee-morning:wed:1030',
      'series:shopping-bus:wed:1100',
    ]);
    expect(r.errors.map(e => e.message).sort()).toEqual(['skip:cancelled', 'skip:online_only', 'skip:past_event']);
  });

  it('série semanal: 2 ocorrências, hora local com fim, fuso da fonte', () => {
    const chair = run().items.find(i => i.title === 'Chair Exercise Club')!;
    expect(chair.occurrences).toEqual([
      { date: '2026-12-03', time: '10:30', end_date: null, end_time: '11:45' },
      { date: '2026-12-10', time: '10:30', end_date: null, end_time: '11:45' },
    ]);
    expect(chair.raw_payload['timezone']).toBe('Europe/London');
    expect(observedRecurrence(chair.occurrences)).toBe('semanal (observado)');
    expect(chair.raw_payload['occurrence_urls']).toHaveLength(2);
  });

  it('local: nome e morada separados, código postal extraído, sem "United Kingdom"', () => {
    const chair = run().items.find(i => i.title === 'Chair Exercise Club')!;
    expect(chair.venue_mention).toEqual({
      raw_text: 'The Barnes Green Centre',
      raw_address_text: 'Church Road, Barnes, London, SW13 9HE',
      confidence_hint: 'explicit_name',
    });
    expect(chair.raw_payload['postcode']).toBe('SW13 9HE');
  });

  it('sem LOCATION → venue_mention null (não inventa)', () => {
    expect(run().items.find(i => i.title === 'Shopping Bus')!.venue_mention).toBeNull();
  });

  it('privacidade: nenhum nome, telefone ou e-mail da descrição chega aos itens', () => {
    const r = run();
    const dump = JSON.stringify([r.items, r.series]);
    expect(dump).not.toMatch(/Jane|Doe|7946|jane@|example\.test\b(?!.*fishhelp)/);
    for (const it of r.items) {
      expect(it.description).toBeNull();
      expect(it.contact_phone).toBeNull();
      expect(it.contact_email).toBeNull();
    }
  });

  it('sinais da allowlist: preço, reserva, transporte, evidência explícita', () => {
    const chair = run().series.find(s => s.item.title === 'Chair Exercise Club')!;
    expect(chair.item.price_text).toBe('£5.00 per session.');
    expect(chair.item.is_free_hint).toBeNull();
    expect(chair.signals.booking).toBe('booking_essential');
    expect(chair.signals.transport_available).toBe(true);
    expect(chair.signals.explicit_older).toMatch(/older people/);
    expect(chair.physical_hint).toBe(true);
  });

  it('dia inteiro e drop-in', () => {
    const r = run();
    expect(r.items.find(i => i.title === 'Christmas Fair')!.occurrences[0]!.time).toBeNull();
    expect(r.series.find(s => s.item.title === 'Coffee Morning')!.signals.booking).toBe('drop_in');
  });
});

describe('fetchIcs: um único pedido, falha fechada', () => {
  it('envia User-Agent e Accept, pede só o URL do ICS', async () => {
    const f = vi.fn(async () => ({ status: 200, text: ICS }));
    const r = await new FishIcsCollector(f, TODAY, NOW).collect();
    expect(f).toHaveBeenCalledOnce();
    expect(f).toHaveBeenCalledWith(FISH_CONFIG.ics_url, { headers: expect.objectContaining({ 'User-Agent': FISH_CONFIG.user_agent, Accept: 'text/calendar' }) });
    expect(r.items).toHaveLength(4);
  });

  it('o URL do ICS não usa caminhos proibidos pelo robots.txt', () => {
    expect(FISH_CONFIG.ics_url).not.toMatch(/wp-json|rest_route|post_type=tribe_events|\/page\//);
  });

  it.each([[429, 'x'], [500, 'x'], [200, '<html>não é ics</html>']])('HTTP %i / corpo inválido → erro', async (status, text) => {
    const f = vi.fn(async () => ({ status, text }));
    await expect(new FishIcsCollector(f, TODAY, NOW).collect()).rejects.toThrow(/ICS FiSH/);
  });
});

describe('fishText', () => {
  it('frases com contacto pessoal são descartadas antes de qualquer extracção', () => {
    const s = safeSentences('Great for older people. Call Bob on 07700 900123. Email a@b.test for details.');
    expect(s).toEqual(['Great for older people.']);
  });

  it('descarta só a oração com contacto: preço e reserva ao lado de "call" sobrevivem', () => {
    const s = extractSignals('Weekly class. £5.00 per session, Booking Essential, please call Bob on 07700 900123.');
    expect(s.price_text).toBe('£5.00 per session, Booking Essential');
    expect(s.booking).toBe('booking_essential');
    expect(JSON.stringify(s)).not.toMatch(/Bob|07700/);
  });

  it('o preço guarda o contexto (almoço ≠ preço da actividade)', () => {
    expect(extractSignals('Our weekly talk. Lunch is available afterwards for £8.00.').price_text)
      .toBe('Lunch is available afterwards for £8.00.');
  });

  it('título com possível nome de pessoa é sinalizado', async () => {
    const { titleMayContainPersonName } = await import('../fishText');
    expect(titleMayContainPersonName('Tuesday Talk - Wildlife Photographer Jane Smith')).toBe(true);
    expect(titleMayContainPersonName('Tuesday Talk - Kew Ukulele Band')).toBe(false);
    expect(titleMayContainPersonName('Good Afternoon Choir')).toBe(false);
  });

  it('DTEND igual a DTSTART → sem hora de fim', () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1\nSUMMARY:Singing\nDTSTART;TZID=Europe/London:20261203T133000\nDTEND;TZID=Europe/London:20261203T133000\nLOCATION:Hall\\, SW13 9HE\nEND:VEVENT\nEND:VCALENDAR';
    const it0 = new FishIcsCollector(noFetch, TODAY, NOW).fromIcs(ics).items[0]!;
    expect(it0.occurrences[0]).toEqual({ date: '2026-12-03', time: '13:30', end_date: null, end_time: null });
  });

  it('preço ausente não vira gratuito; "free of charge" explícito sim', () => {
    expect(extractSignals('Tea and cake.').is_free_hint).toBeNull();
    expect(extractSignals('This session is free of charge.').is_free_hint).toBe(true);
    expect(extractSignals('Enjoy a free cup of tea.').is_free_hint).toBeNull();
  });

  it('demência/cuidadores é público, mas não é evidência explícita de 60+', () => {
    const s = extractSignals('For people living with dementia and their carers.');
    expect(s.audience_snippets).toHaveLength(1);
    expect(s.explicit_older).toBeNull();
  });

  it('splitLocation e chaves', () => {
    expect(splitLocation('Hare & Hounds, 216 Upper Richmond Road, SW14 8AH, United Kingdom'))
      .toEqual({ name: 'Hare & Hounds', address: '216 Upper Richmond Road, SW14 8AH' });
    expect(splitLocation(null)).toBeNull();
    expect(dayOfWeek('2026-12-03')).toBe('thu');
    expect(seriesKey('MeetUpMondays™', '2026-11-30', '11:00')).toBe('series:meetupmondays:mon:1100');
  });

  it('recorrência observada', () => {
    const o = (date: string) => ({ date, time: null, end_date: null, end_time: null });
    expect(observedRecurrence([o('2026-12-04')])).toBe('ocorrência única na janela do ICS');
    expect(observedRecurrence([o('2026-12-04'), o('2026-12-18')])).toBe('quinzenal (observado)');
    expect(observedRecurrence([o('2026-12-02'), o('2026-12-16'), o('2026-12-23')])).toMatch(/intervalos irregulares/);
  });
});
