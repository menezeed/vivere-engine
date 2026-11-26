/**
 * Parser mínimo de iCalendar (RFC 5545) para colectores de agenda.
 *
 * Só o necessário para feeds públicos de eventos (ex.: The Events Calendar):
 * desdobra linhas (RFC 5545 §3.1), separa parâmetros (TZID, VALUE) e
 * desescapa texto (§3.3.11). NÃO expande RRULE: devolve-a como texto, e o
 * colector decide (os feeds lidos até hoje trazem uma VEVENT por ocorrência).
 *
 * Datas: hora LOCAL tal como a fonte a dá, com o TZID ao lado. Não converte
 * fusos (o fuso da região é tratado à parte, ver U8).
 */

export interface IcsDateValue {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, ou null para eventos de dia inteiro (VALUE=DATE). */
  time: string | null;
  /** TZID do parâmetro; 'UTC' quando o valor termina em Z; null se flutuante. */
  tzid: string | null;
}

export interface IcsEvent {
  uid: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  url: string | null;
  categories: string[];
  status: string | null;
  rrule: string | null;
  start: IcsDateValue | null;
  end: IcsDateValue | null;
}

interface Prop { name: string; params: Record<string, string>; value: string }

/** Desdobra linhas continuadas (começam por espaço ou tab). */
export function unfoldLines(ics: string): string[] {
  const raw = ics.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out.filter(l => l.length > 0);
}

/** Texto iCalendar: \n, \, \; e \\ . */
export function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function parseProp(line: string): Prop | null {
  // O nome e os parâmetros vão até ao primeiro ':' fora de aspas.
  let inQuote = false;
  let idx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) { idx = i; break; }
  }
  if (idx < 0) return null;
  const [name, ...paramParts] = line.slice(0, idx).split(';');
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(idx + 1) };
}

export function parseIcsDate(p: Prop): IcsDateValue | null {
  const m = p.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (p.params['VALUE'] === 'DATE' || m[4] === undefined) return { date, time: null, tzid: p.params['TZID'] ?? null };
  return { date, time: `${m[4]}:${m[5]}`, tzid: m[7] ? 'UTC' : (p.params['TZID'] ?? null) };
}

/** Devolve as VEVENT do calendário (ignora VTIMEZONE, VALARM, etc.). */
export function parseIcs(ics: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: IcsEvent | null = null;
  let depth = 0; // componentes aninhados dentro da VEVENT (ex.: VALARM)
  for (const line of unfoldLines(ics)) {
    const p = parseProp(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value.toUpperCase() === 'VEVENT' && !cur) {
        cur = { uid: null, summary: null, description: null, location: null, url: null, categories: [], status: null, rrule: null, start: null, end: null };
      } else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      if (cur && depth > 0) depth--;
      else if (cur && p.value.toUpperCase() === 'VEVENT') { events.push(cur); cur = null; }
      continue;
    }
    if (!cur || depth > 0) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value.trim() || null; break;
      case 'SUMMARY': cur.summary = unescapeText(p.value).trim() || null; break;
      case 'DESCRIPTION': cur.description = unescapeText(p.value) || null; break;
      case 'LOCATION': cur.location = unescapeText(p.value).trim() || null; break;
      case 'URL': cur.url = p.value.trim() || null; break;
      case 'STATUS': cur.status = p.value.trim().toUpperCase() || null; break;
      case 'RRULE': cur.rrule = p.value.trim() || null; break;
      case 'CATEGORIES':
        cur.categories.push(...p.value.split(/(?<!\\),/).map(c => unescapeText(c).trim()).filter(Boolean));
        break;
      case 'DTSTART': cur.start = parseIcsDate(p); break;
      case 'DTEND': cur.end = parseIcsDate(p); break;
    }
  }
  return events;
}
