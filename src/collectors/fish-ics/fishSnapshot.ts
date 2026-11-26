/**
 * FiSH Neighbourhood Care — plano de ingestão a partir do SNAPSHOT já
 * recolhido (relatório do scripts/preview-fish.ts). Piloto UK, só staging.
 *
 * Porquê um snapshot: a integração usa só os dados já recolhidos de forma
 * permitida (1 pedido ao ICS, 26/11/2026). Este módulo NÃO faz pedidos HTTP.
 *
 * Curadoria (determinística, testada):
 * 1. Ocorrências anteriores a `today` saem; séries sem ocorrências ficam de fora.
 * 2. Serviços (ex.: Shopping Bus) não são actividades: ficam de fora (hold).
 * 3. Títulos "<Categoria> - <tema>" (ex.: "Tuesday Talk - …") juntam-se numa
 *    série "<Categoria>": o tema muda em cada sessão e pode ter o nome de
 *    um orador, por isso não é copiado.
 * 4. A elegibilidade é recalculada com proposeEligibility (mesmas regras
 *    e formato da Issue #62) e fica no raw_payload como PROPOSTA.
 * 5. Guarda final: nenhum campo pode ter e-mail ou telefone.
 */
import type { RawActivityItem, RawOccurrence } from '../../types/RawActivityItem';
import type { EligibilityRecord } from '../../review-api/eligibility/eligibilityAudit';
import { proposeEligibility, SERVICE, RESTRICTED_AUDIENCE, EXPLICIT_60PLUS } from '../../review-api/eligibility/proposal';
import { PRICE } from './fishText';
import { FISH_CONFIG } from './config';
import { slugify } from './fishText';

export interface PreviewActivity {
  source_item_id: string;
  titulo: string;
  url_oficial: string | null;
  urls_ocorrencias: string[];
  publico_alvo: string[];
  evidencia_60plus: string | null;
  datas: string[];
  horario: string[];
  fuso: string;
  local: { nome: string; morada: string | null; codigo_postal: string | null } | null;
  local_varia_entre_ocorrencias: boolean;
  custo: string | null;
  gratuito_declarado: boolean;
  inscricao: { reserva: 'booking_essential' | 'booking_advisable' | 'drop_in' | null; transporte_disponivel: boolean };
  disponibilidade: string;
  categorias: string[];
  titulo_pode_ter_nome_de_pessoa: boolean;
  elegibilidade_proposta: EligibilityRecord;
}

export interface PreviewSnapshot {
  gerado_em: string;
  hoje: string;
  dry_run: true;
  escrita_em_bd: false;
  fonte: { source_key: string; ics_url: string; pedidos_http: number };
  produto: string;
  atividades: PreviewActivity[];
}

export interface HeldItem { source_item_id: string; title: string; reason: string }

export interface FishPlan {
  items: RawActivityItem[];
  proposals: EligibilityRecord[];
  held: HeldItem[];
  merged: Array<{ into: string; from: string[] }>;
  past_occurrences_removed: number;
}

/** E-mail, ou qualquer sequência telefónica (nacional ou internacional) com 9+ dígitos. */
const PERSONAL = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\(?\d[\d ().-]{7,}\d/;

/**
 * Público: a frase da fonte NUNCA é guardada (Codex r0, achado 1). Só uma
 * etiqueta fixa; o revisor lê a frase na página oficial (URL guardada).
 */
const AUDIENCE_TAGS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [RESTRICTED_AUDIENCE, 'restricted_condition_and_carers', 'Restricted: people living with dementia or memory loss, and carers'],
  [/\b(everyone|all) welcome\b/i, 'open_to_all', 'Open to all (source: everyone welcome)'],
  [/\bnot (a group )?for beginners\b/i, 'not_for_beginners', 'Not for beginners'],
  [/\bmembers? (are )?welcome\b/i, 'members_welcome', 'FiSH members welcome'],
];
const OTHER_AUDIENCE_TAG = ['other_audience_text', 'Other audience text in source (not copied; see official URL)'] as const;

export function audienceTags(snippets: readonly string[]): Array<{ tag: string; label: string }> {
  const out = new Map<string, string>();
  for (const s of snippets) {
    const hit = AUDIENCE_TAGS.find(([re]) => re.test(s));
    const [tag, label] = hit ? [hit[1], hit[2]] : OTHER_AUDIENCE_TAG;
    out.set(tag, label);
  }
  return [...out].map(([tag, label]) => ({ tag, label }));
}

/** Evidência explícita: só o nível, nunca a frase. */
export function explicitOlderLevel(text: string | null): { level: '60plus' | 'older_no_age'; label: string } | null {
  if (!text) return null;
  return EXPLICIT_60PLUS.test(text)
    ? { level: '60plus', label: 'over 60 (explicit in source; see official URL)' }
    : { level: 'older_no_age', label: 'older people, no age threshold (see official URL)' };
}

/** Preço: só os valores (ex.: "£5.00 per session"); a frase não é guardada. */
export function priceFacts(text: string | null): string | null {
  if (!text) return null;
  const all = [...text.matchAll(new RegExp(PRICE.source, 'gi'))].map(m => m[0].trim());
  if (all.length === 0) return null;
  return all.join('; ') + (/\b(lunch|meal)\b/i.test(text) && !/\b(lunch|meal)\b/i.test(all.join(' ')) ? ' (lunch)' : '');
}
const SERIES_KEY = /^series:([a-z0-9-]+):(mon|tue|wed|thu|fri|sat|sun):(\d{4}|allday)$/;
const GENERIC_VENUE = /\b(pub|inn|arms|hotel|caf[eé]|coffee shop|restaurant|hare (and|&) hounds)\b/i;

export function parsePreviewSnapshot(json: unknown): PreviewSnapshot {
  const s = json as Partial<PreviewSnapshot>;
  if (!s || typeof s !== 'object') throw new Error('snapshot: JSON inválido');
  if (s.dry_run !== true || s.escrita_em_bd !== false) throw new Error('snapshot: só se aceita o relatório de preview (dry_run)');
  if (s.fonte?.source_key !== FISH_CONFIG.source_key) throw new Error('snapshot: fonte diferente de FiSH');
  if (s.produto !== FISH_CONFIG.product_key) throw new Error('snapshot: produto diferente do piloto UK');
  if (!s.gerado_em || Number.isNaN(Date.parse(s.gerado_em))) throw new Error('snapshot: gerado_em inválido');
  if (!Array.isArray(s.atividades)) throw new Error('snapshot: atividades em falta');
  for (const a of s.atividades) {
    if (!SERIES_KEY.test(a.source_item_id)) throw new Error(`snapshot: source_item_id inválido (${a.source_item_id})`);
    if (!a.titulo?.trim()) throw new Error(`snapshot: título vazio (${a.source_item_id})`);
    if (!a.datas.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error(`snapshot: data inválida (${a.source_item_id})`);
    if (a.horario.length !== 1) throw new Error(`snapshot: horário não uniforme na série (${a.source_item_id})`);
    // Todos os URLs que podem ser gravados, incluindo o de recurso (Codex r0, achado 5),
    // com forma estrita: sem query, fragmento, credenciais nem conteúdo codificado (r1, achado 1).
    for (const u of [...a.urls_ocorrencias, ...(a.url_oficial === null ? [] : [a.url_oficial])]) {
      if (!isOfficialEventUrl(u)) throw new Error(`snapshot: URL fora do site oficial (${a.source_item_id})`);
      if (slugLooksLikePhone(u.split('/')[4] ?? '')) throw new Error(`guarda de dados pessoais: telefone no URL (${a.source_item_id})`);
    }
    // Segmentos variáveis e campos estruturados (Codex r2, achado 1).
    if (slugLooksLikePhone(SERIES_KEY.exec(a.source_item_id)![1]!)) throw new Error('guarda de dados pessoais: telefone no source_item_id');
    if (a.fuso !== FISH_CONFIG.timezone) throw new Error(`snapshot: fuso inválido (${a.source_item_id})`);
    if (a.local) {
      if (a.local.codigo_postal !== null && !UK_POSTCODE.test(a.local.codigo_postal)) throw new Error(`snapshot: código postal inválido (${a.source_item_id})`);
      if (typeof a.local.nome !== 'string' || (a.local.morada !== null && typeof a.local.morada !== 'string')) throw new Error(`snapshot: local inválido (${a.source_item_id})`);
    }
  }
  // O URL do ICS gravado é a constante da configuração, nunca o valor do JSON.
  if (s.fonte.ics_url !== FISH_CONFIG.ics_url) throw new Error('snapshot: ics_url diferente do ICS oficial');
  return s as PreviewSnapshot;
}

/** Código postal britânico (forma completa). */
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/;

/**
 * Slug com aspecto de telefone: grupos de 3–5 dígitos separados por hífen
 * (020-8876-0000) ou 9+ dígitos seguidos. Os sufixos do WordPress
 * ("-2-2-2") têm grupos de 1 dígito e não contam.
 */
export function slugLooksLikePhone(slug: string): boolean {
  return /(?:^|-)\d{3,5}(?:-\d{3,5}){1,3}(?:-|$)|\d{9,}/.test(slug);
}

/** https://www.fishhelp.org.uk/event/<slug>/[<AAAA-MM-DD>/] — nada mais. */
const EVENT_URL = /^https:\/\/www\.fishhelp\.org\.uk\/event\/[a-z0-9-]{1,120}\/(\d{4}-\d{2}-\d{2}\/)?$/;
export function isOfficialEventUrl(u: unknown): u is string {
  return typeof u === 'string' && EVENT_URL.test(u);
}

function parseHorario(h: string): { time: string | null; end_time: string | null } {
  if (h === 'sem hora') return { time: null, end_time: null };
  const m = /^(\d{2}:\d{2})(?:–(\d{2}:\d{2}))?$/.exec(h);
  if (!m) throw new Error(`snapshot: horário inválido (${h})`);
  return { time: m[1]!, end_time: m[2] ?? null };
}

/** "<Categoria> - <tema>": devolve a categoria quando o título começa por ela. */
function themedPrefix(a: PreviewActivity): string | null {
  if (a.categorias.length !== 1) return null;
  const cat = a.categorias[0]!.trim();
  return a.titulo.startsWith(`${cat} - `) ? cat : null;
}

/** Campos de TEXTO gravados (datas, ids e URLs ficam de fora: têm dígitos legítimos). */
function assertNoPersonalData(item: RawActivityItem, extraText: readonly string[]): void {
  const texts = [
    item.title, item.raw_category_text, item.price_text,
    item.venue_mention?.raw_text, item.venue_mention?.raw_address_text, ...extraText,
  ].filter((t): t is string => typeof t === 'string');
  if (texts.some(t => PERSONAL.test(t))) throw new Error(`guarda de dados pessoais: e-mail ou telefone em ${item.source_item_id}`);
}

export function planFromSnapshot(snapshot: PreviewSnapshot, today: string): FishPlan {
  const held: HeldItem[] = [];
  const merged: FishPlan['merged'] = [];
  let pastRemoved = 0;

  // 1. Junta "<Categoria> - <tema>" por categoria + dia + hora.
  const groups = new Map<string, PreviewActivity[]>();
  for (const a of snapshot.atividades) {
    const [, , dow, hhmm] = SERIES_KEY.exec(a.source_item_id)!;
    const cat = themedPrefix(a);
    const key = cat ? `series:${slugify(cat)}:${dow}:${hhmm}` : a.source_item_id;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  const items: RawActivityItem[] = [];
  const proposals: EligibilityRecord[] = [];

  for (const [key, members] of groups) {
    const first = members[0]!;
    const cat = themedPrefix(first);
    const title = cat ?? first.titulo.trim();
    if (cat) merged.push({ into: key, from: members.map(m => m.source_item_id) });

    // 2. Ocorrências futuras (inclui hoje), sem repetir datas.
    const { time, end_time } = parseHorario(first.horario[0]!);
    const pairs = members.flatMap(m => m.datas.map((d, i) => ({ date: d, url: m.urls_ocorrencias[i] ?? m.url_oficial })));
    const future = pairs.filter(p => p.date >= today);
    pastRemoved += pairs.length - future.length;
    const byDate = new Map(future.map(p => [p.date, p.url]));
    const dates = [...byDate.keys()].sort();
    if (dates.length === 0) {
      held.push({ source_item_id: key, title, reason: 'sem ocorrências futuras' });
      continue;
    }
    const occurrences: RawOccurrence[] = dates.map(date => ({ date, time, end_date: null, end_time }));
    const urls = dates.map(d => byDate.get(d)).filter((u): u is string => !!u);

    const locations = [...new Set(members.map(m => m.local?.nome).filter((n): n is string => !!n))];
    const loc = members.find(m => m.local)?.local ?? null;
    const differs = locations.length > 1 || members.some(m => m.local_varia_entre_ocorrencias);
    // Público e evidência: só etiquetas fixas; as frases da fonte não passam daqui.
    const audience = audienceTags(members.flatMap(m => m.publico_alvo));
    const explicit = explicitOlderLevel(members.find(m => m.evidencia_60plus)?.evidencia_60plus ?? null);
    const price = priceFacts(first.custo);
    const categories = [...new Set(members.flatMap(m => m.categorias))];
    const booking = first.inscricao.reserva;
    const spacesLimited = members.some(m => m.disponibilidade === 'vagas limitadas');

    const proposal = proposeEligibility({
      source_item_id: key,
      source_url: urls[0] ?? null,
      title,
      kind: occurrences.length > 1 || cat ? 'group' : 'event',
      categories,
      organisation_evidence: FISH_CONFIG.organisation_evidence,
      membership_required: true,
      explicit_older: explicit?.label ?? null,
      audience_snippets: audience.map(a => a.label),
      booking,
      spaces_limited: spacesLimited,
      price_text: price,
      physical_hint: members.some(m => m.elegibilidade_proposta.physical_activity),
      has_location: !!loc,
      generic_venue: GENERIC_VENUE.test(loc?.nome ?? ''),
      schedule_complete: time !== null,
    });
    if (cat) proposal.human_review_notes.push('Série com tema diferente em cada sessão; os temas não foram copiados (podem ter nomes de oradores).');

    // 3. Serviços não são actividades: ficam fora da inserção.
    if (proposal.classification === 'unclear' && SERVICE.test([title, ...categories].join(' '))) {
      held.push({ source_item_id: key, title, reason: 'serviço (não é actividade de lazer) — decisão de âmbito do PO' });
      continue;
    }
    // 4. Título com possível nome de pessoa (e não neutralizado pela fusão): não é gravado.
    if (!cat && members.some(m => m.titulo_pode_ter_nome_de_pessoa)) {
      held.push({ source_item_id: key, title: '(título omitido: pode ter nome de pessoa)', reason: 'título pode conter nome de pessoa — revisão manual' });
      continue;
    }

    const item: RawActivityItem = {
      source_key: FISH_CONFIG.source_key,
      source_item_id: key,
      collected_at: snapshot.gerado_em,
      title,
      description: null,
      raw_category_text: categories.join(', ') || null,
      occurrences,
      recurrence_text_hint: null,
      venue_mention: loc ? { raw_text: loc.nome, raw_address_text: loc.morada, confidence_hint: differs ? 'ambiguous' : 'explicit_name' } : null,
      price_text: price,
      is_free_hint: first.gratuito_declarado ? true : null,
      image_url: null,
      external_url: urls[0] ?? null,
      contact_phone: null,
      contact_email: null,
      language: 'en',
      raw_payload: {
        snapshot: { generated_at: snapshot.gerado_em, ics_url: FISH_CONFIG.ics_url, http_requests_in_this_run: 0 },
        occurrence_urls: urls,
        categories,
        postcode: loc?.codigo_postal ?? null,
        timezone: first.fuso,
        booking,
        spaces_limited: spacesLimited,
        transport_available: members.some(m => m.inscricao.transporte_disponivel),
        audience_tags: audience.map(a => a.tag),
        explicit_older_level: explicit?.level ?? null,
        membership: { required: true, fee_text: FISH_CONFIG.membership.fee_text, source_url: FISH_CONFIG.membership.source_url },
        merged_from: cat ? members.map(m => m.source_item_id) : undefined,
        eligibility_proposal: proposal,
      },
    };
    assertNoPersonalData(item, [...categories, ...audience.map(a => a.label), proposal.evidence, ...proposal.human_review_notes]);
    items.push(item);
    proposals.push(proposal);
  }

  items.sort((a, b) => a.title.localeCompare(b.title));
  proposals.sort((a, b) => a.title.localeCompare(b.title));
  return { items, proposals, held, merged, past_occurrences_removed: pastRemoved };
}

/** Idempotência: o que já existe em staging (mesma fonte, mesmo source_item_id, mesmo produto) não volta a entrar. */
export function splitByExisting(items: RawActivityItem[], existing: ReadonlySet<string>): { insert: RawActivityItem[]; skip: string[] } {
  const insert = items.filter(i => !existing.has(i.source_item_id));
  return { insert, skip: items.filter(i => existing.has(i.source_item_id)).map(i => i.source_item_id) };
}
