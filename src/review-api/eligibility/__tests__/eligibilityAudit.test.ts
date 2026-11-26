/**
 * Issue #62 — dados de elegibilidade 60+ (Richmond u3a) e associação por chave estável.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  loadEligibilityIndex, parseEligibilityDataset, parseEligibilityFilter, isEligibilityExposed,
  EligibilityAuditIndex, CLASSIFICATION_NOTICE, type EligibilityDataset,
} from '../eligibilityAudit';

const RAW = JSON.parse(readFileSync(new URL('../richmond-u3a-60plus.v1.json', import.meta.url), 'utf8'));
const DS: EligibilityDataset = parseEligibilityDataset(RAW);
const index = loadEligibilityIndex();
const UK = 'vivere-60-plus-uk-test';
const item = (title: string) => DS.items.find(i => i.title === title)!;
const keyOf = (i: { source_item_id: string; source_url: string }) =>
  ({ product_key: UK, source_key: 'u3a_richmond', source_item_id: i.source_item_id, external_url: i.source_url });

describe('dados versionados (133 actividades)', () => {
  it('133 registos, chaves e URLs únicas, produto e fonte do piloto', () => {
    expect(DS.items).toHaveLength(133);
    expect(new Set(DS.items.map(i => i.source_item_id)).size).toBe(133);
    expect(new Set(DS.items.map(i => i.source_url)).size).toBe(133);
    expect(DS.product_key).toBe(UK);
    expect(DS.source_key).toBe('u3a_richmond');
  });

  it('distribuição igual à do relatório: 1 / 124 / 7 / 1', () => {
    const by = (k: string) => DS.items.filter(i => i.classification === k).length;
    expect([by('confirmed_60plus'), by('likely_suitable'), by('unclear'), by('unsuitable')]).toEqual([1, 124, 7, 1]);
    expect(item('Seated Exercise').classification).toBe('confirmed_60plus');
  });

  it('nenhuma actividade é "exclusiva 60+" (a u3a não tem limite de idade)', () => {
    expect(DS.items.some(i => i.eligibility_type === 'exclusive_60plus')).toBe(false);
  });

  it('custos desconhecidos ficam null (não confirmado), nunca "gratuito"', () => {
    const stated = DS.items.filter(i => i.additional_costs !== null);
    expect(stated).toHaveLength(7);
    expect(DS.items.filter(i => i.additional_costs === null)).toHaveLength(126);
    // Citações parciais ("alguns locais são gratuitos") são permitidas; um custo
    // nunca é reduzido a "gratuito" sem mais.
    expect(DS.items.some(i => /^\s*(gr[aá]tis|gratuit[oa]s?|free)\s*\.?$/i.test(i.additional_costs ?? ''))).toBe(false);
  });

  it('quota: 4 categorias oficiais, separadas dos custos das actividades', () => {
    expect(DS.membership.fees.map(f => [f.category, f.amount])).toEqual([
      ['individual', 15], ['joint', 12.5], ['associate', 11], ['associates_joint', 10],
    ]);
    expect(DS.membership.source_url).toBe('https://u3abeacon.org.uk/u3ajoin.php?sc=VMQG&u3a=466');
  });
});

describe('coerência com o relatório do PR #61 (sem refazer a auditoria)', () => {
  const md = readFileSync(new URL('../../../../docs/operacao/AUDITORIA-60PLUS-RICHMOND.md', import.meta.url), 'utf8');
  // | # | Actividade | `classe` | confiança | evidência | disponibilidade | custos | restrições | recomendação | [link](url) |
  const rows = new Map(md.split('\n').filter(l => /^\| \d+ \| /.test(l)).map(l => {
    const cells = l.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim().replace(/\\\|/g, '|'));
    const url = cells[9].match(/\((https:[^)]+)\)/)![1];
    return [url, { title: cells[1].replace(/ \(evento\)$/, ''), cls: cells[2].replace(/`/g, ''), evidence: cells[4], rec: cells[8] }];
  }));

  it('o relatório tem as mesmas 133 URLs', () => {
    expect(rows.size).toBe(133);
    expect([...rows.keys()].sort()).toEqual(DS.items.map(i => i.source_url).sort());
  });

  it.each(DS.items.map(i => [i.title, i] as const))('%s: classe, evidência e recomendação iguais', (_t, i) => {
    const r = rows.get(i.source_url)!;
    expect(r.title).toBe(i.title);
    expect(r.cls).toBe(i.classification);
    expect(r.evidence).toBe(i.evidence);
    expect(r.rec).toBe(i.recommendation);
  });
});

describe('associação por chave estável (falha fechada)', () => {
  const seated = item('Seated Exercise');

  it('chave + URL iguais → matched', () => {
    const r = index.lookup(keyOf(seated));
    expect(r.status).toBe('matched');
  });

  it('URL diferente → mismatch, sem dados expostos e sem aprovação', () => {
    const k = { ...keyOf(seated), external_url: 'https://rut.u3asite.uk/u3a_groups/outra/' };
    expect(index.lookup(k).status).toBe('mismatch');
    const d = index.detail(k)!;
    expect(d.record).toBeNull();
    expect(d.classification).toBeNull();
    expect(d.approval_allowed).toBe(false);
  });

  it('mesmo título mas id desconhecido → not_audited (nunca associa por título)', () => {
    const k = { ...keyOf(seated), source_item_id: 'group:999999' };
    expect(index.lookup(k).status).toBe('not_audited');
  });

  it('source_key diferente ou sem source_item_id → not_audited', () => {
    expect(index.lookup({ ...keyOf(seated), source_key: 'outra_fonte' }).status).toBe('not_audited');
    expect(index.lookup({ ...keyOf(seated), source_item_id: null }).status).toBe('not_audited');
  });

  it('produto BR não é coberto: sem bloco e sem efeito na aprovação', () => {
    const br = { product_key: 'vivere-60-mais', source_key: 'x', source_item_id: 'y', external_url: 'z' };
    expect(index.summary(br)).toBeNull();
    expect(index.detail(br)).toBeNull();
    expect(index.approvalAllowed(br)).toBe(true);
  });

  it('todas as 133 associam com a sua própria chave', () => {
    expect(DS.items.every(i => index.lookup(keyOf(i)).status === 'matched')).toBe(true);
  });
});

describe('aprovação: classificação não é aprovação', () => {
  it('só confirmed_60plus permite approve/promote', () => {
    const allowed = DS.items.filter(i => index.approvalAllowed(keyOf(i)));
    expect(allowed.map(i => i.title)).toEqual(['Seated Exercise']);
  });

  it('detalhe traz o aviso, a auditoria e a quota só quando há adesão', () => {
    const d = index.detail(keyOf(item('Seated Exercise')))!;
    expect(d.notice).toBe(CLASSIFICATION_NOTICE);
    expect(d.audit).toEqual({ report: 'docs/operacao/AUDITORIA-60PLUS-RICHMOND.md', verified_at: '2026-11-26', schema_version: 1 });
    expect(d.membership?.fees).toHaveLength(4);
    const evento = DS.items.find(i => i.kind === 'event')!;
    expect(index.detail(keyOf(evento))!.membership).toBeNull(); // adesão não confirmada no evento
  });
});

describe('filtro por classificação', () => {
  it('classes → in com os ids certos', () => {
    const f = index.filterIds(UK, ['unclear', 'unsuitable'])!;
    expect(f.mode).toBe('in');
    expect(f.ids).toHaveLength(8);
  });
  it('not_audited → not_in com todos os ids auditados', () => {
    const f = index.filterIds(UK, ['not_audited'])!;
    expect(f).toEqual({ mode: 'not_in', ids: expect.any(Array) });
    expect(f.ids).toHaveLength(133);
  });
  it('not_audited + likely → exclui só as outras classes', () => {
    expect(index.filterIds(UK, ['not_audited', 'likely_suitable'])!.ids).toHaveLength(9);
  });
  it('produto sem auditoria → null', () => {
    expect(index.filterIds('vivere-60-mais', ['unclear'])).toBeNull();
  });
  it.each([
    [undefined, null], ['', null], ['unclear', ['unclear']], ['unclear,unclear,not_audited', ['unclear', 'not_audited']],
    ['approved', 'invalid'], ['unclear,', ['unclear']], ['UNCLEAR', 'invalid'],
  ])('parseEligibilityFilter(%j) → %j', (raw, expected) => {
    expect(parseEligibilityFilter(raw as string | undefined)).toEqual(expected);
  });
});

describe('validação do ficheiro', () => {
  const clone = () => JSON.parse(JSON.stringify(RAW));
  it.each([
    ['id duplicado', (d: any) => { d.items[1].source_item_id = d.items[0].source_item_id; }],
    ['classe inválida', (d: any) => { d.items[0].classification = 'approved'; }],
    ['URL não https', (d: any) => { d.items[0].source_url = 'http://x'; }],
    ['membership_required false', (d: any) => { d.items[0].membership_required = false; }],
    ['custo vazio', (d: any) => { d.items[0].additional_costs = ''; }],
    ['id fora do formato', (d: any) => { d.items[0].source_item_id = 'Seated Exercise'; }],
    ['schema_version 2', (d: any) => { d.schema_version = 2; }],
    ['quota sem valor', (d: any) => { d.membership.fees[0].amount = 0; }],
  ])('%s → erro', (_l, mutate) => {
    const d = clone(); mutate(d);
    expect(() => parseEligibilityDataset(d)).toThrow();
  });
  it('dois ficheiros do mesmo produto → erro', () => {
    expect(() => new EligibilityAuditIndex([DS, DS])).toThrow(/repetido/);
  });
});

describe('feature flag REVIEW_API_ELIGIBILITY_AUDIT', () => {
  it.each([[undefined, true], ['on', true], ['off', false], ['OFF', false]])('%j → %j', (v, exp) => {
    expect(isEligibilityExposed({ REVIEW_API_ELIGIBILITY_AUDIT: v as string | undefined })).toBe(exp);
  });
});
