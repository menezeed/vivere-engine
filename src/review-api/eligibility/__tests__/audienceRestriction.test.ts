/**
 * Público restrito (decisão do PO, 26/11/2026): identificação clara de
 * pessoa com demência / cuidador / ambos. Sem rede.
 */
import { describe, it, expect } from 'vitest';
import { parseAudienceRestriction, audienceRestrictionLabel } from '../audienceRestriction';
import { restrictedAudience } from '../../../collectors/fish-ics/fishSnapshot';
import { ActivityReviewRepository } from '../../repositories/ActivityReviewRepository';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('restrictedAudience (colector FiSH)', () => {
  it.each([
    [['For people living with early stage dementia and their carers.'], { condition: 'dementia', target: 'both' }],
    [['An opportunity for people with dementia and their carers to meet others and sing.'], { condition: 'dementia', target: 'both' }],
    [['An opportunity for people living with memory loss in East Sheen to meet each other.'], { condition: 'memory_loss', target: 'person' }],
    [['A support group for carers of someone with dementia.'], { condition: 'dementia', target: 'both' }],
    [['Support for carers looking after loved ones with dementia'], { condition: 'dementia', target: 'carer' }],
    [['Everyone welcome!'], null],
  ])('%j → %j', (snippets, expected) => {
    expect(restrictedAudience(snippets)).toEqual(expected);
  });
});

describe('parseAudienceRestriction (Review API)', () => {
  it('só valores enumerados; rótulo gerado aqui', () => {
    expect(parseAudienceRestriction({ condition: 'dementia', target: 'both', label: 'IGNORADO' }))
      .toEqual({ condition: 'dementia', target: 'both', label: 'Público restrito: pessoa com demência e cuidador (ambos)' });
    expect(audienceRestrictionLabel('memory_loss', 'person')).toBe('Público restrito: pessoa com perda de memória');
    expect(audienceRestrictionLabel('dementia', 'carer')).toBe('Público restrito: cuidador de pessoa com demência');
    for (const bad of [null, undefined, 'dementia', {}, { condition: 'dementia' }, { condition: 'x', target: 'both' }, { condition: 'dementia', target: 'everyone' }]) {
      expect(parseAudienceRestriction(bad)).toBeNull();
    }
  });

  it('a lista devolve audience_restriction a partir do alias do raw_payload', async () => {
    const row = (ra: unknown) => ({
      id: 'a', raw_activity_item_id: 'r', product_key: 'p', proposal_status: 'pending_review', venue_resolution_status: 'unresolved', created_at: '2026-11-26T00:00:00Z',
      raw_activity_items: { title: 'T', source_key: 's', occurrences: [], restricted_audience: ra },
    });
    const builder: Record<string, unknown> = {};
    const calls: unknown[][] = [];
    for (const m of ['schema', 'from', 'select', 'order', 'range', 'eq', 'ilike', 'in', 'not', 'or']) builder[m] = (...a: unknown[]) => { calls.push([m, ...a]); return builder; };
    builder['then'] = (res: (v: unknown) => unknown) => res({ data: [row({ condition: 'memory_loss', target: 'person' }), row(null), row({ condition: 'x' })], count: 3, error: null });
    const out = await new ActivityReviewRepository(builder as unknown as SupabaseClient).list({});
    expect(out.items.map(i => i.audience_restriction?.label ?? null)).toEqual(['Público restrito: pessoa com perda de memória', null, null]);
    expect(String(calls.find(c => c[0] === 'select')![1])).toMatch(/restricted_audience:raw_payload->restricted_audience/);
  });
});
