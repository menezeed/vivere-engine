export type EligibilityClass = 'confirmed_60plus' | 'likely_suitable' | 'unclear' | 'unsuitable';
export interface EligibilityAuditItem {
  reportOrdinal: number; canonicalSourceUrl: string; title: string; eligibilityClass: EligibilityClass;
  confidence: 'high' | 'medium' | 'low'; evidenceSummary: string; eligibilityScope: 'not_confirmed';
  availability: { status: 'open_to_new_members' | 'full_waitlist' | 'closed_to_new_members' | 'one_off_unknown_vacancies'; sourceText: string };
  participation: { membershipRequired: 'required' | 'not_confirmed'; sourceText: string };
  membershipFeeNote: string;
  additionalCost: { status: 'reported' | 'not_indicated' | 'not_confirmed'; sourceText: string | null };
  schedule: { status: 'incomplete' | 'not_confirmed'; sourceText: null };
  location: { status: 'generic_only' | 'not_confirmed'; sourceText: null };
  recommendation: string; checkedAt: string;
}
/** Canonical source URL is the stable join key. No title or ordinal fallback. */
export function canonicalRichmondSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'rut.u3asite.uk' || url.username || url.password || url.port) return null;
    url.search = ''; url.hash = '';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    return url.toString();
  } catch { return null; }
}
export function buildRichmondEligibilityIndex(items: EligibilityAuditItem[]): Map<string, EligibilityAuditItem> {
  const index = new Map<string, EligibilityAuditItem>();
  for (const item of items) {
    const key = canonicalRichmondSourceUrl(item.canonicalSourceUrl);
    if (!key) throw new Error('Invalid Richmond eligibility source URL');
    if (index.has(key)) throw new Error('Duplicate Richmond eligibility source URL');
    index.set(key, item);
  }
  return index;
}
/** Missing/invalid/unmatched external_url fails closed; title is not consulted. */
export function findRichmondEligibility(index: ReadonlyMap<string, EligibilityAuditItem>, activity: { external_url?: string | null }): EligibilityAuditItem | null {
  const key = canonicalRichmondSourceUrl(activity.external_url);
  return key ? index.get(key) ?? null : null;
}
