/**
 * u3a SiteWorks — parsers puros com FILTRO DE PRIVACIDADE (piloto UK, U2).
 *
 * As páginas de grupos e eventos da u3a incluem nomes de líderes e
 * organizadores, telefones, emails e links de contacto. Estes parsers só
 * extraem campos em ALLOWLIST (Status, When, Venue; datas/horas/categorias
 * estruturadas); tudo o resto é descartado ANTES de chegar a qualquer item,
 * payload, log ou base de dados. Nunca guardar content.rendered.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&#038;': '&', '&#8217;': "'", '&#039;': "'", '&#8216;': "'", '&#8211;': '-', '&#8212;': '-',
  '&#8220;': '"', '&#8221;': '"', '&nbsp;': ' ', '&quot;': '"', '&lt;': '<', '&gt;': '>',
};

export function decodeEntities(s: string): string {
  return s.replace(/&#?\w+;/g, (m) => ENTITIES[m] ?? m);
}

/** HTML → texto numa linha (sem tags, entidades descodificadas, espaços colapsados). */
export function htmlToText(html: string | null | undefined): string {
  return decodeEntities((html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Únicos rótulos lidos da tabela de dados de um grupo. Contactos NUNCA. */
export const GROUP_FIELD_ALLOWLIST = ['Status', 'When', 'Venue'] as const;
export type GroupField = (typeof GROUP_FIELD_ALLOWLIST)[number];

/**
 * Lê só os campos da allowlist da tabela `u3a_group_table`
 * (`<tr><td>Rótulo:</td><td>Valor</td></tr>`). Qualquer outra linha
 * (Group leader, Tel, Group email, Contact, …) é ignorada sem ser lida.
 */
export function parseGroupFields(html: string): Partial<Record<GroupField, string>> {
  const out: Partial<Record<GroupField, string>> = {};
  const allow = new Set<string>(GROUP_FIELD_ALLOWLIST);
  for (const m of html.matchAll(/<tr>\s*<td>\s*([^<:]+?)\s*:\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)) {
    const label = m[1]!.trim();
    if (!allow.has(label) || label in out) continue;
    const value = htmlToText(m[2]);
    if (value !== '') out[label as GroupField] = value;
  }
  return out;
}

/**
 * Venue de um evento: o conteúdo é texto corrido "… Venue: X Organiser: … Booking: …".
 * Só o valor de Venue, cortado antes do próximo rótulo conhecido.
 */
export function parseEventVenue(html: string): string | null {
  const text = htmlToText(html);
  const m = text.match(/\bVenue:\s*(.*?)\s*(?=\b(?:Organiser|Organizer|Booking|Cost|Price|Event type|Date|Time|Group|Contact)\s*:|$)/);
  const v = m?.[1]?.trim() ?? '';
  return v === '' ? null : v.slice(0, 120);
}

/** Morada de um venue ("Address: … Accessibility: …"), sem a parte de acessibilidade. */
export function parseVenueAddress(html: string): string | null {
  const text = htmlToText(html);
  const m = text.match(/\bAddress:\s*(.*?)\s*(?=\b(?:Accessibility|This venue is referenced|Directions|Website|Phone|Tel)\b|$)/i);
  const v = m?.[1]?.trim() ?? '';
  return v === '' ? null : v;
}

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** Código postal do Reino Unido normalizado ("tw11 8hg" → "TW11 8HG"), ou null. */
export function extractUkPostcode(text: string | null | undefined): string | null {
  const m = (text ?? '').match(UK_POSTCODE);
  return m ? `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}` : null;
}

/** Local privado (casa de membros) — excluído por privacidade. */
export function isPrivateVenue(name: string | null | undefined): boolean {
  return /\b(members?'?s?'?\s+homes?|private\s+(home|house|address)|leader'?s?\s+home)\b/i.test(name ?? '');
}

/** Local só online — não é um local físico. */
export function isOnlineVenue(name: string | null | undefined): boolean {
  return /\b(zoom|google\s+meet|microsoft\s+teams|teams\s+meeting|online)\b/i.test(name ?? '');
}

/** Local genérico, sem identificação ("Various locations", "TBC"). */
export function isUnspecifiedVenue(name: string | null | undefined): boolean {
  return /^(various( locations)?|tbc|tba|to be confirmed|see (below|notes))$/i.test((name ?? '').trim());
}

/** A u3a marca cancelamentos só no título ("CANCELLED - …"). */
export function isCancelledTitle(title: string): boolean {
  return /\b(cancell?ed|postponed)\b/i.test(title);
}

/** "Active, open to new members" etc. → activo. "No longer meeting" → inactivo. */
export function isActiveGroupStatus(status: string | null | undefined): boolean {
  return /^active\b/i.test((status ?? '').trim());
}

/** "HH:MM" (24h) a partir de "HH:MM" da API; null se vazio/inválido. */
export function normaliseApiTime(t: string | null | undefined): string | null {
  const m = (t ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}
