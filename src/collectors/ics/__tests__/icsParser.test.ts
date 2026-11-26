import { describe, it, expect } from 'vitest';
import { parseIcs, unfoldLines, unescapeText } from '../icsParser';

const cal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

describe('icsParser', () => {
  it('desdobra linhas continuadas (espaço e tab)', () => {
    expect(unfoldLines('SUMMARY:Abc\r\n def\r\n\tghi\r\nUID:1')).toEqual(['SUMMARY:Abcdefghi', 'UID:1']);
  });

  it('desescapa texto', () => {
    expect(unescapeText('a\\, b\\; c\\nd\\\\e')).toBe('a, b; c\nd\\e');
  });

  it('lê DTSTART com TZID (hora local, sem conversão)', () => {
    const [e] = parseIcs(cal('BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:T\r\nDTSTART;TZID=Europe/London:20260704T103000\r\nDTEND;TZID=Europe/London:20260704T114500\r\nEND:VEVENT'));
    expect(e!.start).toEqual({ date: '2026-07-04', time: '10:30', tzid: 'Europe/London' });
    expect(e!.end).toEqual({ date: '2026-07-04', time: '11:45', tzid: 'Europe/London' });
  });

  it('dia inteiro (VALUE=DATE) → time null; sufixo Z → UTC', () => {
    const evs = parseIcs(cal('BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261212\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261212T090000Z\r\nEND:VEVENT'));
    expect(evs[0]!.start).toEqual({ date: '2026-12-12', time: null, tzid: null });
    expect(evs[1]!.start).toEqual({ date: '2026-12-12', time: '09:00', tzid: 'UTC' });
  });

  it('ignora propriedades de VALARM dentro da VEVENT e VTIMEZONE fora', () => {
    const evs = parseIcs(cal('BEGIN:VTIMEZONE\r\nTZID:Europe/London\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nDESCRIPTION:real\r\nBEGIN:VALARM\r\nDESCRIPTION:alarme\r\nEND:VALARM\r\nEND:VEVENT'));
    expect(evs).toHaveLength(1);
    expect(evs[0]!.description).toBe('real');
  });

  it('CATEGORIES com várias linhas e vírgulas escapadas; RRULE devolvida como texto', () => {
    const [e] = parseIcs(cal('BEGIN:VEVENT\r\nCATEGORIES:A,B\r\nCATEGORIES:C\\, D\r\nRRULE:FREQ=WEEKLY;BYDAY=TU\r\nEND:VEVENT'));
    expect(e!.categories).toEqual(['A', 'B', 'C, D']);
    expect(e!.rrule).toBe('FREQ=WEEKLY;BYDAY=TU');
  });

  it('valor com ":" depois do primeiro separador (URL) fica inteiro', () => {
    const [e] = parseIcs(cal('BEGIN:VEVENT\r\nURL:https://x.test/a?b=c:d\r\nEND:VEVENT'));
    expect(e!.url).toBe('https://x.test/a?b=c:d');
  });
});
