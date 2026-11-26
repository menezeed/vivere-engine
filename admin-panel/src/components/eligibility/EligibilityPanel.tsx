import { ExternalLink, Info, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/index';
import { SectionCard } from '@/components/ui/Cards';
import type { EligibilityDetail, EligibilitySummary } from '@/types/eligibility';
import type { ActivityStagingItem } from '@/types/activity';
import {
  eligibilityBadge, availabilityText, additionalCostsText, membershipText, textOrNotConfirmed,
  membershipFeeLines, ELIGIBILITY_TYPE_LABEL, CONFIDENCE_LABEL, NOT_CONFIRMED, type BadgeTone,
} from './eligibilityView';

const TONE: Record<BadgeTone, 'green' | 'blue' | 'yellow' | 'red' | 'gray'> = {
  green: 'green', teal: 'blue', amber: 'yellow', red: 'red', gray: 'gray',
};

/** Badge 60+ (Issue #62). Nada para produtos sem auditoria. */
export function EligibilityBadge({ eligibility }: { eligibility: EligibilitySummary | null | undefined }) {
  const b = eligibilityBadge(eligibility);
  if (!b) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={TONE[b.tone]}>{b.label}</Badge>
      {eligibility?.needs_human_review && (
        <span title="Revisão humana pendente"><AlertTriangle size={12} className="text-amber-500" /></span>
      )}
    </span>
  );
}

export const CLASSIFICATION_NOTICE_FALLBACK =
  'Classificação de elegibilidade não é aprovação nem publicação. O estado de revisão não muda.';

export function EligibilityNotice({ text }: { text?: string }) {
  return (
    <div className="flex items-start gap-2 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <Info size={15} className="mt-0.5 shrink-0" />
      <span>{text ?? CLASSIFICATION_NOTICE_FALLBACK}</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <div className="text-sm text-gray-700">{children}</div>
    </div>
  );
}

const unconfirmed = (v: string) => v.startsWith(NOT_CONFIRMED) ? <span className="text-amber-700">{v}</span> : v;

/** Detalhe da elegibilidade 60+ de uma actividade. */
export function EligibilityPanel({ activity }: { activity: ActivityStagingItem }) {
  const e = activity.eligibility as EligibilityDetail | null | undefined;
  if (!e) return null;
  const r = e.record;
  const payload = activity.raw_payload ?? {};
  const when = typeof payload['when_text'] === 'string' ? payload['when_text'] as string : null;
  const venueText = (typeof payload['venue_text'] === 'string' ? payload['venue_text'] as string : null)
    ?? activity.venue_mention_raw_text ?? null;

  return (
    <SectionCard title="Elegibilidade 60+ (auditoria)">
      <div className="space-y-5">
        <EligibilityNotice text={e.notice} />

        <div className="flex flex-wrap items-center gap-3">
          <EligibilityBadge eligibility={e} />
          {r && <span className="text-xs text-gray-500">Confiança: {CONFIDENCE_LABEL[r.confidence]}</span>}
          {!e.approval_allowed && (
            <span className="text-xs text-gray-500">Aprovar/Promover indisponível: elegibilidade não confirmada.</span>
          )}
        </div>

        {e.status === 'mismatch' && (
          <p className="text-sm text-red-700">
            Os identificadores desta actividade não correspondem à auditoria (URL diferente). Nenhum dado da auditoria é mostrado.
          </p>
        )}
        {e.status === 'not_audited' && (
          <p className="text-sm text-amber-700">Esta actividade não consta da auditoria: elegibilidade {NOT_CONFIRMED.toLowerCase()}.</p>
        )}

        {r && (
          <>
            {r.human_review_notes.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold mb-1 flex items-center gap-1.5"><AlertTriangle size={14} /> Revisão humana pendente</p>
                <ul className="list-disc pl-5 space-y-1">{r.human_review_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-5">
              <Row label="Evidência (paráfrase da fonte)">{r.evidence}</Row>
              <Row label="Fonte oficial">
                <a href={r.source_url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-vivere-teal hover:underline break-all">
                  <ExternalLink size={12} /> {r.source_url}
                </a>
              </Row>
              <Row label="Tipo de elegibilidade">{unconfirmed(ELIGIBILITY_TYPE_LABEL[r.eligibility_type])}</Row>
              <Row label="Data da verificação">{e.audit.verified_at}</Row>
              <Row label="Disponibilidade">{unconfirmed(availabilityText(r.availability))}</Row>
              <Row label="Participação / adesão">{unconfirmed(membershipText(r.membership_required))}</Row>
              <Row label="Custos adicionais da actividade">{unconfirmed(additionalCostsText(r.additional_costs))}</Row>
              <Row label="Horário (fonte)">
                {unconfirmed(textOrNotConfirmed(when))}
                {!r.schedule_complete_in_source && <p className="text-xs text-amber-700 mt-1">Horário incompleto na fonte.</p>}
              </Row>
              <Row label="Local (fonte)">
                {unconfirmed(textOrNotConfirmed(venueText))}
                {r.generic_venue && <p className="text-xs text-gray-500 mt-1">Local genérico (pub, hotel ou café): não indica público 60+.</p>}
              </Row>
              <Row label="Restrições">
                <ul className="space-y-0.5">
                  <li>Actividade física: {r.physical_activity ? `sim${r.distances_cited.length ? ` (${r.distances_cited.join(', ')})` : ''}` : 'não indicada'}</li>
                  <li>Nível: {r.levels_cited.length ? r.levels_cited.join(' / ') : 'não indicado'}</li>
                  <li>Acesso: {unconfirmed(textOrNotConfirmed(r.access_notes))}</li>
                </ul>
              </Row>
              <Row label="Recomendação">{r.recommendation}</Row>
            </div>
          </>
        )}

        {e.membership && (
          <div className="rounded border border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-400 mb-2">
              Quota de associação ({e.membership.organisation}). Não é o preço da actividade.
            </p>
            <ul className="text-sm text-gray-700 space-y-0.5">
              {membershipFeeLines(e.membership).map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            <p className="text-xs text-gray-500 mt-2">
              Válida até {e.membership.valid_until}. Verificada a {e.membership.verified_at}. {e.membership.note}{' '}
              <a href={e.membership.source_url} target="_blank" rel="noopener noreferrer" className="text-vivere-teal hover:underline">Fonte</a>
            </p>
          </div>
        )}

        <p className="text-xs text-gray-400">Relatório: {e.audit.report} (versão {e.audit.schema_version}).</p>
      </div>
    </SectionCard>
  );
}
