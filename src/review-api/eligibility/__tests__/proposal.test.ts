/**
 * Propostas de elegibilidade para fontes novas (reutiliza o formato da Issue #62).
 */
import { describe, it, expect } from 'vitest';
import { proposeEligibility, crossSourceDuplicates, titleSimilarity, PROPOSAL_NOTE, type ProposalInput } from '../proposal';
import { parseEligibilityDataset } from '../eligibilityAudit';

const base: ProposalInput = {
  source_item_id: 'series:x:mon:1000', source_url: 'https://www.fishhelp.org.uk/event/x/', title: 'Coffee Morning', kind: 'group',
  categories: [], organisation_evidence: 'Organização para a comunidade mais velha.', membership_required: true,
  explicit_older: null, audience_snippets: [], booking: null, spaces_limited: false, price_text: null,
  physical_hint: false, has_location: true, generic_venue: false, schedule_complete: true,
};

describe('proposeEligibility', () => {
  it('evidência explícita na actividade → confirmed_60plus, mas confiança nunca "high" (automático)', () => {
    const r = proposeEligibility({ ...base, explicit_older: 'A class for older people.' });
    expect(r.classification).toBe('confirmed_60plus');
    expect(r.confidence).toBe('medium');
    expect(r.evidence).toMatch(/older people/);
  });

  it('só evidência da organização → likely_suitable', () => {
    expect(proposeEligibility(base).classification).toBe('likely_suitable');
  });

  it('serviço (Shopping Bus) → unclear, decisão de âmbito', () => {
    expect(proposeEligibility({ ...base, title: 'Shopping Bus' }).classification).toBe('unclear');
  });

  it('outro público → unsuitable', () => {
    expect(proposeEligibility({ ...base, title: 'Story time for children' }).classification).toBe('unsuitable');
  });

  it('sem local e sem horário completo → unclear', () => {
    expect(proposeEligibility({ ...base, has_location: false, schedule_complete: false }).classification).toBe('unclear');
  });

  it('todas as propostas pedem revisão humana; custos null ficam null; drop-in → open', () => {
    const r = proposeEligibility({ ...base, booking: 'drop_in' });
    expect(r.human_review_notes[0]).toBe(PROPOSAL_NOTE);
    expect(r.additional_costs).toBeNull();
    expect(r.availability).toBe('open');
    expect(r.eligibility_type).toBe('unknown');
  });

  it('o registo cabe no formato validado do dataset da Issue #62', () => {
    const rec = proposeEligibility({ ...base, booking: 'booking_essential', price_text: '£5.00 per session' });
    const ds = parseEligibilityDataset({
      schema_version: 1, product: 'p', source: 'fish_neighbourhood_care', audit_report: 'r', verified_at: '2026-11-26',
      membership: { organisation: 'o', source_url: 'https://x', verified_at: 'd', valid_until: 'v', currency: 'GBP', note: 'n',
        fees: [{ category: 'c', label: 'l', amount: 30, per_person: true, description: 'd' }] },
      items: [rec],
    });
    expect(ds.items[0]!.source_item_id).toBe('series:x:mon:1000');
    expect(ds.items[0]!.recommendation).toMatch(/Reserva obrigatória/);
  });
});

describe('crossSourceDuplicates (só relatório)', () => {
  const existing = [
    { title: 'Singing for Pleasure', source_key: 'u3a_richmond', source_item_id: 'group:400' },
    { title: 'Bridge', source_key: 'u3a_richmond', source_item_id: 'group:957' },
  ];
  it('mesmo nome normalizado e nomes semelhantes', () => {
    const d = crossSourceDuplicates([
      { title: 'BRIDGE', source_key: 'fish', source_item_id: 'series:bridge:wed:1400' },
      { title: 'Singing for pleasure group', source_key: 'fish', source_item_id: 'series:s:thu:1500' },
      { title: 'Coffee Corner', source_key: 'fish', source_item_id: 'series:c:wed:1030' },
    ], existing);
    expect(d.map(x => [x.candidate.title, x.reason])).toEqual([
      ['BRIDGE', 'same_normalized_title'],
      ['Singing for pleasure group', 'similar_title'],
    ]);
  });
  it('mesma fonte não conta; semelhança 0 com palavras só de ligação', () => {
    expect(crossSourceDuplicates([{ title: 'Bridge', source_key: 'u3a_richmond', source_item_id: 'x' }], existing)).toEqual([]);
    expect(titleSimilarity('The Group', 'The Club')).toBe(0);
  });
});
