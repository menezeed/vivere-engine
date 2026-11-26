import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRichmondEligibilityIndex, canonicalRichmondSourceUrl, findRichmondEligibility } from '../richmondEligibility';
import type { EligibilityAuditItem } from '../richmondEligibility';
const dataset = JSON.parse(readFileSync(new URL('../richmond-eligibility.json', import.meta.url), 'utf8')) as {recordCount:number;classificationCounts:Record<string,number>;availabilityCounts:Record<string,number>;items:EligibilityAuditItem[]};
describe('Richmond 60+ eligibility audit fixture', () => {
 it('contains all 133 report rows and expected distributions', () => {
  expect(dataset.items).toHaveLength(133); expect(dataset.recordCount).toBe(133);
  expect(dataset.classificationCounts).toEqual({confirmed_60plus:1,likely_suitable:124,unclear:7,unsuitable:1});
  expect(dataset.availabilityCounts).toEqual({open_to_new_members:94,full_waitlist:33,closed_to_new_members:5,one_off_unknown_vacancies:1});
 });
 it('has 133 unique canonical source URL keys', () => {
  const keys=dataset.items.map(i=>canonicalRichmondSourceUrl(i.canonicalSourceUrl));
  expect(keys.every(Boolean)).toBe(true); expect(new Set(keys).size).toBe(133); expect(buildRichmondEligibilityIndex(dataset.items).size).toBe(133);
 });
 it('normalizes query, fragment, host case and trailing slash only', () => {
  expect(canonicalRichmondSourceUrl('https://RUT.u3asite.uk/u3a_groups/extend-exercise/?utm=qa#top')).toBe('https://rut.u3asite.uk/u3a_groups/extend-exercise/');
  expect(canonicalRichmondSourceUrl('http://rut.u3asite.uk/u3a_groups/extend-exercise/')).toBeNull();
  expect(canonicalRichmondSourceUrl('https://example.org/u3a_groups/extend-exercise/')).toBeNull();
 });
 it('matches only external_url and fails closed if missing or unmatched', () => {
  const index=buildRichmondEligibilityIndex(dataset.items);
  expect(findRichmondEligibility(index,{external_url:'https://rut.u3asite.uk/u3a_groups/extend-exercise?src=test'})?.eligibilityClass).toBe('confirmed_60plus');
  expect(findRichmondEligibility(index,{external_url:null})).toBeNull();
  expect(findRichmondEligibility(index,{external_url:'https://rut.u3asite.uk/unknown/'})).toBeNull();
 });
 it('rejects duplicate canonical keys instead of picking an arbitrary row', () => {
  expect(()=>buildRichmondEligibilityIndex([dataset.items[0],{...dataset.items[0],reportOrdinal:134}])).toThrow(/Duplicate Richmond eligibility source URL/);
 });
 it('keeps unknown cost, age scope, schedule and location explicitly unconfirmed', () => {
  expect(dataset.items.every(i=>i.eligibilityScope==='not_confirmed')).toBe(true);
  expect(dataset.items.filter(i=>i.additionalCost.status==='not_indicated').every(i=>i.additionalCost.sourceText==='nenhum indicado na página')).toBe(true);
  expect(dataset.items.every(i=>i.schedule.sourceText===null&&i.location.sourceText===null)).toBe(true);
 });
});
