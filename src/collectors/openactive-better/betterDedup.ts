/**
 * Possíveis duplicados da Better com as outras fontes do piloto (só relatório).
 *
 * - u3a: dataset auditado src/review-api/eligibility/richmond-u3a-60plus.v1.json
 *   (lido pelo script; nada é recolhido de novo).
 * - FiSH: os 11 títulos inseridos em staging (relatório fish-apply de 26/11/2026).
 */
import { crossSourceDuplicates, type CrossSourceDuplicate } from '../../review-api/eligibility/proposal';
import { FISH_SOURCE_KEY } from '../fish-ics/config';
import { BETTER_CONFIG } from './config';
import type { RawActivityItem } from '../../types/RawActivityItem';

export const FISH_TITLES: readonly string[] = [
  'Board Games', 'Coffee Corner', 'FiSH Bridge', 'Good Afternoon Choir', 'MeetUpMondays™',
  'Picassos in the Park Art', 'Retro Club East Sheen', 'Singing for the Brain', 'StarFiSH', 'The Reader', 'Tuesday Talk',
];

export interface U3aDataset { source: string; items: Array<{ source_item_id: string; title: string }> }

export function pilotDuplicates(items: ReadonlyArray<Pick<RawActivityItem, 'title' | 'source_item_id'>>, u3a: U3aDataset): {
  u3a: CrossSourceDuplicate[]; fish: CrossSourceDuplicate[];
} {
  const candidates = items.map(i => ({ title: i.title, source_key: BETTER_CONFIG.source_key, source_item_id: i.source_item_id }));
  return {
    u3a: crossSourceDuplicates(candidates, u3a.items.map(i => ({ title: i.title, source_key: u3a.source, source_item_id: i.source_item_id }))),
    fish: crossSourceDuplicates(candidates, FISH_TITLES.map(t => ({ title: t, source_key: FISH_SOURCE_KEY, source_item_id: `title:${t}` }))),
  };
}
