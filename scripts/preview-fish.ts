/**
 * Preview (dry-run) da FiSH Neighbourhood Care — piloto UK, fontes novas.
 *
 * NÃO grava nada: não importa Supabase, não cria ingestion_run, não toca
 * no staging. Faz no máximo UM pedido HTTP ao ICS público (ou lê um
 * ficheiro local com --ics-file) e escreve um relatório JSON.
 *
 * Uso:
 *   npx tsx scripts/preview-fish.ts --report=<saida.json> [--ics-file=<ficheiro.ics>] [--today=YYYY-MM-DD]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { FishIcsCollector, observedRecurrence, type FetchText } from '../src/collectors/fish-ics/FishIcsCollector';
import { FISH_CONFIG } from '../src/collectors/fish-ics/config';
import { proposeEligibility, crossSourceDuplicates } from '../src/review-api/eligibility/proposal';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export function londonToday(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const GENERIC_VENUE = /\b(pub|inn|arms|hotel|caf[eé]|coffee shop|restaurant|hare (and|&) hounds)\b/i;

async function main(): Promise<void> {
  const reportPath = arg('report');
  if (!reportPath) throw new Error('--report=<ficheiro.json> é obrigatório');
  const icsFile = arg('ics-file');
  const today = arg('today') ?? londonToday();

  let requests = 0;
  const fetchText: FetchText = async (url, init) => {
    if (requests++ > 0) throw new Error('preview: só é permitido um pedido por execução');
    const res = await fetch(url, init);
    return { status: res.status, text: await res.text() };
  };
  const collector = new FishIcsCollector(fetchText, today);
  const ics = icsFile ? readFileSync(icsFile, 'utf8') : await collector.fetchIcs();
  const { series, errors, events_read } = collector.fromIcs(ics);

  const preview = series.map(s => {
    const it = s.item;
    const venueName = it.venue_mention?.raw_text ?? null;
    const proposal = proposeEligibility({
      source_item_id: it.source_item_id,
      source_url: it.external_url,
      title: it.title,
      kind: it.occurrences.length > 1 ? 'group' : 'event',
      categories: (it.raw_payload['categories'] as string[]) ?? [],
      organisation_evidence: FISH_CONFIG.organisation_evidence,
      membership_required: true,
      explicit_older: s.signals.explicit_older,
      audience_snippets: s.signals.audience_snippets,
      booking: s.signals.booking,
      spaces_limited: s.signals.spaces_limited,
      price_text: s.signals.price_text,
      physical_hint: s.physical_hint,
      has_location: !!it.venue_mention,
      generic_venue: GENERIC_VENUE.test(venueName ?? ''),
      schedule_complete: it.occurrences.every(o => o.time !== null),
    });
    return {
      source_item_id: it.source_item_id,
      titulo: it.title,
      descricao: null,
      descricao_nota: 'Não copiada: o texto livre da fonte contém contactos pessoais. Só os trechos da allowlist abaixo.',
      url_oficial: it.external_url,
      urls_ocorrencias: s.occurrence_urls,
      publico_alvo: s.signals.audience_snippets,
      evidencia_60plus: s.signals.explicit_older,
      datas: it.occurrences.map(o => o.date),
      horario: [...new Set(it.occurrences.map(o => o.time ? `${o.time}${o.end_time ? `–${o.end_time}` : ''}` : 'sem hora'))],
      fuso: it.raw_payload['timezone'],
      recorrencia: observedRecurrence(it.occurrences),
      local: it.venue_mention ? { nome: it.venue_mention.raw_text, morada: it.venue_mention.raw_address_text, codigo_postal: it.raw_payload['postcode'] } : null,
      local_varia_entre_ocorrencias: s.locations_differ,
      custo: s.signals.price_text,
      gratuito_declarado: s.signals.is_free_hint === true,
      inscricao: {
        reserva: s.signals.booking,
        adesao: `${FISH_CONFIG.membership.required_text} Quota: ${FISH_CONFIG.membership.fee_text}.`,
        transporte_disponivel: s.signals.transport_available,
      },
      disponibilidade: s.signals.booking === 'drop_in' ? 'aberto (sem reserva)' : s.signals.spaces_limited ? 'vagas limitadas' : 'não confirmada',
      categorias: it.raw_payload['categories'],
      titulo_pode_ter_nome_de_pessoa: it.raw_payload['title_may_contain_person_name'] === true,
      elegibilidade_proposta: it.raw_payload['title_may_contain_person_name'] === true
        ? { ...proposal, human_review_notes: [...proposal.human_review_notes, 'O título pode conter o nome de uma pessoa (ex.: orador): confirmar antes de publicar.'] }
        : proposal,
    };
  });

  // Duplicados com a u3a: lidos do dataset já auditado (ficheiro local; NÃO recolhe a u3a de novo).
  const u3a = JSON.parse(readFileSync(new URL('../src/review-api/eligibility/richmond-u3a-60plus.v1.json', import.meta.url), 'utf8')) as {
    source: string; items: Array<{ source_item_id: string; title: string }>;
  };
  const duplicates = crossSourceDuplicates(
    preview.map(p => ({ title: p.titulo, source_key: FISH_CONFIG.source_key, source_item_id: p.source_item_id })),
    u3a.items.map(i => ({ title: i.title, source_key: u3a.source, source_item_id: i.source_item_id })),
  );

  const byReason = errors.reduce<Record<string, number>>((m, e) => (m[e.message] = (m[e.message] ?? 0) + 1, m), {});
  const byClass = preview.reduce<Record<string, number>>((m, p) => (m[p.elegibilidade_proposta.classification] = (m[p.elegibilidade_proposta.classification] ?? 0) + 1, m), {});
  const report = {
    gerado_em: new Date().toISOString(),
    hoje: today,
    dry_run: true,
    escrita_em_bd: false,
    fonte: { source_key: FISH_CONFIG.source_key, ics_url: icsFile ? `ficheiro local: ${icsFile}` : FISH_CONFIG.ics_url, pedidos_http: requests },
    produto: FISH_CONFIG.product_key,
    resumo: {
      vevents_lidos: events_read,
      series: preview.length,
      ocorrencias_futuras: preview.reduce((n, p) => n + p.datas.length, 0),
      excluidos_por_motivo: byReason,
      elegibilidade_proposta: byClass,
      possiveis_duplicados_u3a: duplicates.length,
    },
    atividades: preview,
    possiveis_duplicados: duplicates,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.resumo, null, 2));
  console.log(`Relatório: ${reportPath}`);
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
