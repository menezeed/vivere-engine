/**
 * Extracção por allowlist da DESCRIPTION do ICS da FiSH (piloto UK).
 *
 * A descrição livre traz nomes, e-mails e telefones de organizadores. Ela
 * NUNCA é guardada: só saem daqui trechos curtos que respondem a perguntas
 * fixas (preço, reserva, público, transporte). Qualquer frase com sinais de
 * contacto pessoal é descartada antes de ser considerada.
 */
import { htmlToText } from '../u3a-siteworks/sanitize';

/** Sinais de contacto pessoal: frases com isto nunca são usadas. */
const PERSONAL = /@|\b(contact|call|ring|phone|tel|telephone|email|e-mail|mobile|text)\b|(\+44|\b0)\d[\d\s]{8,12}\d/i;

/** Público: termos que descrevem a quem se destina (inclui condições de saúde e cuidadores). */
const AUDIENCE = /\b(older|elderly|over[- ]?(50|55|60|65|70)s?|aged? \d\d|\d\d\s?\+|seniors?|pensioners?|retired|later life|dementia|memory loss|parkinson'?s|carers?|live alone|lonel(y|iness)|everyone welcome|all welcome|members? (are )?welcome|new members|beginners|all abilities|for (people|those|anyone))\b/i;

/** Evidência EXPLÍCITA de público mais velho (60+). Condições de saúde não contam. */
export const EXPLICIT_OLDER = /\b(older (people|adults|members|residents|community|person)|elderly|over[- ]?(55|60|65|70)s?|aged (55|60|65|70)\s?(\+|and over|or over)|(55|60|65|70)\s?\+|seniors?|pensioners?|later life|retired people|retirement)\b/i;

export const PRICE = /£\s?\d+(?:[.,]\d{2})?(?:\s*(?:per|a|each|for (?:a|the))\s+(?:session|class|lesson|person|week|month|year|term|course|visit|meal|lunch))?/i;
const FREE = /\bfree (of charge|to attend|entry|admission|session)\b|\bno charge\b|\bentry is free\b/i;

/** Sinal de actividade física (título, categorias ou frases seguras). */
export const PHYSICAL = /\b(exercise|keep fit|fitness|dance|dancing|yoga|pilates|tai chi|walk(s|ing)?|stretch|movement|zumba|chair[- ]based|seated exercise|swim(ming)?|bowls|football|badminton|table tennis)\b/i;

export type BookingSignal = 'booking_essential' | 'booking_advisable' | 'drop_in';

export interface FishTextSignals {
  price_text: string | null;
  is_free_hint: boolean | null;
  booking: BookingSignal | null;
  spaces_limited: boolean;
  transport_available: boolean;
  audience_snippets: string[];
  explicit_older: string | null;
}

/**
 * Frases sem dados pessoais. Cada frase é partida em orações (vírgula,
 * ponto e vírgula, travessão); só as orações com sinal de contacto são
 * descartadas, para não perder "£5 per session" ao lado de "call …".
 */
export function safeSentences(description: string | null | undefined): string[] {
  const text = (description ?? '').split(/\n+/).map(l => htmlToText(l)).join('\n');
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.split(/\s*(?:[,;]|\s[–—-]\s)\s*/).map(c => c.trim()).filter(c => c && !PERSONAL.test(c)).join(', '))
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/** Oração que contém o preço (contexto: "Lunch £8.00" ≠ preço da actividade). */
function priceClause(sentences: string[]): string | null {
  for (const s of sentences) {
    const m = s.match(PRICE);
    if (!m) continue;
    const clause = s.length > 140 ? s.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 80).trim() : s;
    return clause.replace(/\s+/g, ' ');
  }
  return null;
}

export function extractSignals(description: string | null | undefined): FishTextSignals {
  const sentences = safeSentences(description);
  const joined = sentences.join(' ');
  const price = priceClause(sentences);
  const booking: BookingSignal | null =
    /\bbooking (is )?essential\b|\bmust be booked\b|\bbooking is required\b/i.test(joined) ? 'booking_essential'
    : /\bbooking (is )?(advisable|recommended)\b/i.test(joined) ? 'booking_advisable'
    : /\bno need to book\b|\bjust drop in\b|\bdrop[- ]in\b/i.test(joined) ? 'drop_in'
    : null;
  const audience = sentences.filter(s => AUDIENCE.test(s)).map(s => s.length > 200 ? `${s.slice(0, 197)}…` : s).slice(0, 3);
  const explicit = sentences.find(s => EXPLICIT_OLDER.test(s)) ?? null;
  return {
    price_text: price,
    is_free_hint: FREE.test(joined) ? true : null, // ausência de preço NÃO é "gratuito"
    booking,
    spaces_limited: /\bspaces? (are |is )?limited\b|\blimited (spaces|places)\b/i.test(joined),
    transport_available: /\btransport (is )?(available|can be (provided|arranged))\b/i.test(joined),
    audience_snippets: audience,
    explicit_older: explicit ? (explicit.length > 200 ? `${explicit.slice(0, 197)}…` : explicit) : null,
  };
}

/**
 * Título que parece trazer o nome de uma pessoa (ex.: orador convidado:
 * "Talk - Photographer John Smith"). Heurística conservadora: duas palavras
 * capitalizadas seguidas no fim, depois de um separador. Só sinaliza.
 */
const ORG_NOUN = /\b(band|group|club|choir|society|trust|centre|center|museum|gardens?|orchestra|company|theatre|park|church|library|association|ensemble|singers|players|caf[eé]|project|team|council|school|hospital|service|network|foundation|fair|market|walk|talk|lunch|party|quiz)$/i;

export function titleMayContainPersonName(title: string): boolean {
  const tail = title.split(/\s[-–—:]\s/).slice(1).join(' ').trim();
  return /\b[A-Z][a-z]+\s+[A-Z][a-z'-]+$/.test(tail) && !ORG_NOUN.test(tail);
}

/** "the-barnes-green-centre" — para chaves estáveis. */
export function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** LOCATION do The Events Calendar: "Nome, Rua, Bairro, Cidade, CP, País". */
export function splitLocation(location: string | null): { name: string; address: string | null } | null {
  const loc = (location ?? '').trim();
  if (!loc) return null;
  const parts = loc.split(',').map(p => p.trim()).filter(Boolean);
  const name = parts[0]!;
  const rest = parts.slice(1).filter(p => !/^united kingdom$|^uk$/i.test(p)).join(', ');
  return { name, address: rest || null };
}
