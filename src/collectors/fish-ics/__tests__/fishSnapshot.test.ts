/**
 * Plano de ingestão FiSH a partir do snapshot do preview. Dados sintéticos.
 */
import { describe, it, expect } from 'vitest';
import { isOfficialEventUrl, parsePreviewSnapshot, planFromSnapshot, splitByExisting, type PreviewActivity, type PreviewSnapshot } from '../fishSnapshot';
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
    // Forma estrita (Codex r1, achado 1): sem query, fragmento, http, outro host ou conteúdo codificado.
    for (const bad of [
      'https://www.fishhelp.org.uk/event/coffee/?email=x@y.org',
      'https://www.fishhelp.org.uk/event/coffee/2026-12-02/#x',
      'https://www.fishhelp.org.uk/event/jane%40mail-com/',
      'http://www.fishhelp.org.uk/event/coffee/',
      'https://www.fishhelp.org.uk.evil.example/event/coffee/',
      'https://user:pw@www.fishhelp.org.uk/event/coffee/',
    ]) {
      expect(() => parsePreviewSnapshot(snap([act({ source_item_id: 'series:x:wed:1030', titulo: 'X', urls_ocorrencias: [bad] })])), bad).toThrow(/site oficial/);
    }
    expect(isOfficialEventUrl('https://www.fishhelp.org.uk/event/board-games-2-2/2026-11-30/')).toBe(true);
    // ics_url do JSON tem de ser o oficial; o gravado é sempre a constante.
    expect(() => parsePreviewSnapshot({ ...ok, fonte: { ...ok.fonte, ics_url: 'https://evil.example/?q=x@y.org' } })).toThrow(/ics_url/);
    // URL de recurso também é validado (Codex r0, achado 5)
    expect(() => parsePreviewSnapshot(snap([act({ source_item_id: 'series:x:wed:1030', titulo: 'X', urls_ocorrencias: [], url_oficial: 'https://evil.example/x' })]))).toThrow(/site oficial/);
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

  it('guarda de dados pessoais: e-mail ou telefone (britânico ou internacional) num campo gravado falha', () => {
    expect(() => planFromSnapshot(snap([act({ source_item_id: 'series:a:wed:1030', titulo: 'Call 020 8876 0000' })]), '2026-11-26')).toThrow(/dados pessoais/);
    expect(() => planFromSnapshot(snap([act({ source_item_id: 'series:a:wed:1030', titulo: 'A', local: { nome: 'Hall +33 1 23 45 67 89', morada: null, codigo_postal: null } })]), '2026-11-26')).toThrow(/dados pessoais/);
    expect(() => planFromSnapshot(snap([act({ source_item_id: 'series:a:wed:1030', titulo: 'A', categorias: ['x@y.org'] })]), '2026-11-26')).toThrow(/dados pessoais/);
  });

  it('as frases da fonte (público, evidência, preço) nunca são gravadas; só etiquetas e valores (Codex r0, achado 1)', () => {
    const p = planFromSnapshot(snap([act({
      source_item_id: 'series:a:wed:1030', titulo: 'A',
      publico_alvo: ['Jane Smith says everyone welcome!', 'Ask Bob about the weekly quiz'],
      evidencia_60plus: 'Run by Jane Smith for older people',
      custo: 'Our weekly Talk by Jane Smith, followed by an optional hot lunch (£8.00) provided by Age UK.',
    })]), '2026-11-26');
    const json = JSON.stringify(p.items[0]);
    expect(json).not.toMatch(/Jane|Smith|Bob|quiz/);
    expect(p.items[0]!.price_text).toBe('£8.00 (lunch)');
    expect(p.items[0]!.raw_payload['audience_tags']).toEqual(['open_to_all', 'other_audience_text']);
    expect(p.items[0]!.raw_payload['explicit_older_level']).toBe('older_no_age');
    expect(p.proposals[0]!.classification).toBe('likely_suitable');
    expect(JSON.stringify(p.proposals[0])).not.toMatch(/Jane|Smith|Bob/);
  });

  it('título com possível nome de pessoa (não fundido) fica fora e o título não é repetido', () => {
    const p = planFromSnapshot(snap([act({ source_item_id: 'series:talk-jane:tue:1100', titulo: 'Talk with Jane Smith', categorias: ['Talks'], titulo_pode_ter_nome_de_pessoa: true })]), '2026-11-26');
    expect(p.items).toHaveLength(0);
    expect(JSON.stringify(p.held)).not.toMatch(/Jane/);
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
