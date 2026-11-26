/**
 * Plano de ingestão FiSH a partir do snapshot do preview. Dados sintéticos.
 */
import { describe, it, expect } from 'vitest';
import { parsePreviewSnapshot, planFromSnapshot, splitByExisting, type PreviewActivity, type PreviewSnapshot } from '../fishSnapshot';
import { parseEligibilityDataset } from '../../../review-api/eligibility/eligibilityAudit';
import u3aDataset from '../../../review-api/eligibility/richmond-u3a-60plus.v1.json';

const SITE = 'https://www.fishhelp.org.uk/event/';

function act(over: Partial<PreviewActivity> & { source_item_id: string; titulo: string }): PreviewActivity {
  const datas = over.datas ?? ['2026-12-02', '2026-12-09'];
  return {
    url_oficial: `${SITE}x/${datas[0]}/`,
    urls_ocorrencias: datas.map(d => `${SITE}${over.source_item_id.split(':')[1]}/${d}/`),
    publico_alvo: [],
    evidencia_60plus: null,
    datas,
    horario: ['10:30–12:00'],
    fuso: 'Europe/London',
    local: { nome: 'Test Hall', morada: 'Test Hall, London, SW13 0AA', codigo_postal: 'SW13 0AA' },
    local_varia_entre_ocorrencias: false,
    custo: null,
    gratuito_declarado: false,
    inscricao: { reserva: null, transporte_disponivel: false },
    disponibilidade: 'não confirmada',
    categorias: [over.titulo],
    titulo_pode_ter_nome_de_pessoa: false,
    elegibilidade_proposta: { physical_activity: false } as PreviewActivity['elegibilidade_proposta'],
    ...over,
  };
}

function snap(atividades: PreviewActivity[]): PreviewSnapshot {
  return {
    gerado_em: '2026-11-26T11:59:21.300Z', hoje: '2026-11-26', dry_run: true, escrita_em_bd: false,
    fonte: { source_key: 'fish_neighbourhood_care', ics_url: 'https://www.fishhelp.org.uk/events/list/?ical=1', pedidos_http: 1 },
    produto: 'vivere-60-plus-uk-test', atividades,
  };
}

describe('parsePreviewSnapshot', () => {
  it('aceita o relatório de preview e recusa o resto', () => {
    const ok = snap([act({ source_item_id: 'series:coffee:wed:1030', titulo: 'Coffee' })]);
    expect(parsePreviewSnapshot(ok).atividades).toHaveLength(1);
    expect(() => parsePreviewSnapshot({ ...ok, dry_run: false })).toThrow(/preview/);
    expect(() => parsePreviewSnapshot({ ...ok, fonte: { ...ok.fonte, source_key: 'u3a_richmond' } })).toThrow(/FiSH/);
    expect(() => parsePreviewSnapshot({ ...ok, produto: 'vivere-60-mais' })).toThrow(/produto/);
    expect(() => parsePreviewSnapshot(snap([act({ source_item_id: 'evil', titulo: 'X' })]))).toThrow(/source_item_id/);
    expect(() => parsePreviewSnapshot(snap([act({ source_item_id: 'series:x:wed:1030', titulo: 'X', urls_ocorrencias: ['https://evil.example/'] })]))).toThrow(/site oficial/);
    expect(() => parsePreviewSnapshot(snap([act({ source_item_id: 'series:x:wed:1030', titulo: 'X', horario: ['10:00', '11:00'] })]))).toThrow(/uniforme/);
  });
});

describe('planFromSnapshot', () => {
  it('remove ocorrências passadas (hoje conta) e deixa de fora séries sem futuro', () => {
    const p = planFromSnapshot(snap([
      act({ source_item_id: 'series:choir:thu:1500', titulo: 'Choir', datas: ['2026-11-26', '2026-12-03'] }),
      act({ source_item_id: 'series:old:mon:1000', titulo: 'Old', datas: ['2026-11-20'] }),
    ]), '2026-11-27');
    expect(p.items.map(i => i.source_item_id)).toEqual(['series:choir:thu:1500']);
    expect(p.items[0]!.occurrences.map(o => o.date)).toEqual(['2026-12-03']);
    expect(p.items[0]!.external_url).toBe(`${SITE}choir/2026-12-03/`);
    expect(p.held).toEqual([{ source_item_id: 'series:old:mon:1000', title: 'Old', reason: 'sem ocorrências futuras' }]);
    expect(p.past_occurrences_removed).toBe(2);
  });

  it('serviço (Shopping Bus) fica fora da inserção', () => {
    const p = planFromSnapshot(snap([act({ source_item_id: 'series:shopping-bus:wed:1100', titulo: 'Shopping Bus' })]), '2026-11-26');
    expect(p.items).toHaveLength(0);
    expect(p.held[0]!.reason).toMatch(/serviço/);
  });

  it('"Tuesday Talk - <tema>" junta-se numa série sem o tema (pode ter nome de orador)', () => {
    const p = planFromSnapshot(snap([
      act({ source_item_id: 'series:tuesday-talk-somebody-famous:tue:1100', titulo: 'Tuesday Talk - Photographer Somebody Famous', categorias: ['Tuesday Talk'], datas: ['2026-12-01'], titulo_pode_ter_nome_de_pessoa: true }),
      act({ source_item_id: 'series:tuesday-talk-band:tue:1100', titulo: 'Tuesday Talk - Band', categorias: ['Tuesday Talk'], datas: ['2026-12-08'] }),
    ]), '2026-11-26');
    expect(p.items).toHaveLength(1);
    const it0 = p.items[0]!;
    expect(it0.source_item_id).toBe('series:tuesday-talk:tue:1100');
    expect(it0.title).toBe('Tuesday Talk');
    expect(it0.occurrences.map(o => o.date)).toEqual(['2026-12-01', '2026-12-08']);
    expect(JSON.stringify(it0)).not.toMatch(/Somebody|Famous/);
    expect(p.merged).toEqual([{ into: 'series:tuesday-talk:tue:1100', from: ['series:tuesday-talk-somebody-famous:tue:1100', 'series:tuesday-talk-band:tue:1100'] }]);
  });

  it('público restrito (demência) → proposta unclear, mas continua a ser inserida em pending_review', () => {
    const p = planFromSnapshot(snap([act({ source_item_id: 'series:sing:thu:1330', titulo: 'Sing', publico_alvo: ['For people living with dementia and their carers.'] })]), '2026-11-26');
    expect(p.items).toHaveLength(1);
    expect(p.proposals[0]!.classification).toBe('unclear');
    expect(p.proposals[0]!.evidence).toMatch(/público restrito/);
  });

  it('campos do item: sem descrição nem contactos; adesão £30 e proposta no raw_payload; fim nulo quando a fonte não o indica', () => {
    const p = planFromSnapshot(snap([act({ source_item_id: 'series:sing:thu:1330', titulo: 'Sing', horario: ['13:30'], custo: '£5.00 per session' })]), '2026-11-26');
    const i = p.items[0]!;
    expect(i.description).toBeNull();
    expect(i.contact_email).toBeNull();
    expect(i.contact_phone).toBeNull();
    expect(i.is_free_hint).toBeNull();
    expect(i.price_text).toBe('£5.00 per session');
    expect(i.occurrences[0]).toEqual({ date: '2026-12-02', time: '13:30', end_date: null, end_time: null });
    expect(i.venue_mention).toEqual({ raw_text: 'Test Hall', raw_address_text: 'Test Hall, London, SW13 0AA', confidence_hint: 'explicit_name' });
    expect(i.raw_payload['membership']).toMatchObject({ required: true, fee_text: expect.stringContaining('£30') });
    expect(i.raw_payload['snapshot']).toMatchObject({ http_requests_in_this_run: 0 });
    expect(p.proposals[0]!.human_review_notes[0]).toMatch(/revisão humana/);
  });

  it('as propostas cabem no formato validado do dataset da Issue #62', () => {
    const p = planFromSnapshot(snap([
      act({ source_item_id: 'series:a:wed:1030', titulo: 'A' }),
      act({ source_item_id: 'series:b:thu:1030', titulo: 'B', datas: ['2026-12-03'] }),
    ]), '2026-11-26');
    const { items: _u3a, ...header } = u3aDataset as Record<string, unknown>;
    const ds = parseEligibilityDataset({ ...header, source: 'fish_neighbourhood_care', items: p.proposals });
    expect(ds.items).toHaveLength(2);
  });

  it('guarda de dados pessoais: e-mail ou telefone num campo copiado falha', () => {
    expect(() => planFromSnapshot(snap([act({ source_item_id: 'series:a:wed:1030', titulo: 'A', custo: 'ring 020 8876 0000' })]), '2026-11-26')).toThrow(/dados pessoais/);
    expect(() => planFromSnapshot(snap([act({ source_item_id: 'series:a:wed:1030', titulo: 'A', publico_alvo: ['email x@y.org'] })]), '2026-11-26')).toThrow(/dados pessoais/);
  });
});

describe('splitByExisting (idempotência)', () => {
  it('salta o que já está em staging; segunda execução não insere nada', () => {
    const p = planFromSnapshot(snap([
      act({ source_item_id: 'series:a:wed:1030', titulo: 'A' }),
      act({ source_item_id: 'series:b:thu:1030', titulo: 'B' }),
    ]), '2026-11-26');
    const first = splitByExisting(p.items, new Set());
    expect(first.insert).toHaveLength(2);
    const second = splitByExisting(p.items, new Set(first.insert.map(i => i.source_item_id)));
    expect(second.insert).toHaveLength(0);
    expect(second.skip).toEqual(['series:a:wed:1030', 'series:b:thu:1030']);
  });
});
