/**
 * Issue #62 — revisão humana de elegibilidade 60+ no detalhe da actividade.
 *
 * - "Revisar elegibilidade 60+" abre um formulário pré-preenchido com a
 *   proposta automática do colector; o revisor confirma ou corrige e regista
 *   uma classificação FUNDAMENTADA (evidência, URL oficial, data).
 * - O histórico mostra a trilha de auditoria (append-only, mais recente primeiro).
 * - Registar uma revisão NÃO aprova: "Aprovar" só aparece quando a API o
 *   permite (revisão válida "60+ confirmado"); a API valida de novo.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, History, AlertTriangle } from 'lucide-react';
import { SectionCard } from '@/components/ui/Cards';
import { Badge } from '@/components/ui/index';
import { useToast } from '@/components/ui/Toast';
import { ActivityService } from '@/services/ActivityService';
import { ApiError, describeApiError } from '@/api/client';
import type { ActivityStagingItem } from '@/types/activity';
import type { EligibilityReviewInput, EligibilityClass, EligibilityConfidence, EligibilityAvailability } from '@/types/eligibility';
import {
  CLASS_LABEL, CONFIDENCE_LABEL, AVAILABILITY_LABEL, REVIEW_SOURCE_LABEL, REVIEW_STATE_LABEL,
  reviewFormDefaults, validateReviewForm,
} from './eligibilityView';

const TONE = { green: 'green', teal: 'blue', amber: 'yellow', red: 'red', gray: 'gray' } as const;
const inputCls = 'w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-vivere-teal focus:outline-none';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

export function EligibilityReviewSection({ activity }: { activity: ActivityStagingItem }) {
  const qc = useQueryClient();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EligibilityReviewInput>(() => reviewFormDefaults(activity));
  const [issues, setIssues] = useState<string[]>([]);

  const history = useQuery({
    queryKey: ['eligibility-reviews', activity.id],
    queryFn: () => ActivityService.listEligibilityReviews(activity.id),
    enabled: !!activity.eligibility,
    retry: false,
  });
  const unavailable = history.error instanceof ApiError && history.error.status === 400;

  const submit = useMutation({
    mutationFn: (input: EligibilityReviewInput) => ActivityService.submitEligibilityReview(activity.id, input),
    onSuccess: () => {
      success('Revisão de elegibilidade registada (não é aprovação)');
      setOpen(false);
      setIssues([]);
      [['eligibility-reviews', activity.id], ['activity', activity.id], ['activities']].forEach(k => qc.invalidateQueries({ queryKey: k }));
    },
    onError: (err) => {
      const body = err instanceof ApiError ? (err.body as { issues?: string[] } | null) : null;
      if (body?.issues?.length) setIssues(body.issues);
      error('Revisão não registada', describeApiError(err));
    },
  });

  if (!activity.eligibility) return null; // produto sem auditoria: sem revisão 60+

  const e = activity.eligibility;
  const set = <K extends keyof EligibilityReviewInput>(k: K, v: EligibilityReviewInput[K]) => setForm(f => ({ ...f, [k]: v }));
  const nullable = (v: string) => (v.trim() === '' ? null : v);

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const local = validateReviewForm(form);
    setIssues(local);
    if (local.length === 0) submit.mutate({ ...form, evidence_text: form.evidence_text.trim(), evidence_url: form.evidence_url.trim() });
  }

  return (
    <SectionCard title="Revisão de elegibilidade 60+">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-500">Origem da classificação:</span>
          <Badge variant={e.review_source === 'human_review' ? 'blue' : 'gray'}>{REVIEW_SOURCE_LABEL[e.review_source ?? 'none']}</Badge>
          {e.human_review && e.human_review.state !== 'valid' && (
            <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={14} /> {REVIEW_STATE_LABEL[e.human_review.state]}</span>
          )}
          {!open && !unavailable && (
            <button type="button" onClick={() => { setForm(reviewFormDefaults(activity)); setIssues([]); setOpen(true); }}
              className="ml-auto inline-flex items-center gap-1.5 rounded bg-vivere-teal px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              data-testid="review-eligibility-button">
              <ClipboardCheck size={15} /> Revisar elegibilidade 60+
            </button>
          )}
        </div>

        {unavailable && (
          <p className="text-sm text-gray-500">Revisão humana indisponível neste ambiente (a Review API não tem a opção ligada ou a migração 0033 não está aplicada).</p>
        )}

        {open && (
          <form onSubmit={onSubmit} className="space-y-4 rounded border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs text-gray-500">Registar uma classificação não aprova a actividade. A API só permite "Aprovar" com uma revisão válida "60+ confirmado" (verificada há no máximo 180 dias).</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Classificação">
                <select className={inputCls} value={form.classification} onChange={ev => set('classification', ev.target.value as EligibilityClass)}>
                  {(Object.keys(CLASS_LABEL) as EligibilityClass[]).map(c => <option key={c} value={c}>{CLASS_LABEL[c].label}</option>)}
                </select>
              </Field>
              <Field label="Confiança">
                <select className={inputCls} value={form.confidence} onChange={ev => set('confidence', ev.target.value as EligibilityConfidence)}>
                  {(Object.keys(CONFIDENCE_LABEL) as EligibilityConfidence[]).map(c => <option key={c} value={c}>{CONFIDENCE_LABEL[c]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Evidência oficial (paráfrase ou citação curta)" hint="Mínimo 20 caracteres. Sem nomes, e-mails ou telefones de pessoas.">
              <textarea className={inputCls} rows={3} value={form.evidence_text} onChange={ev => set('evidence_text', ev.target.value)} />
            </Field>
            <Field label="URL da evidência (página oficial)">
              <input className={inputCls} value={form.evidence_url} onChange={ev => set('evidence_url', ev.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Público-alvo">
                <input className={inputCls} value={form.audience ?? ''} onChange={ev => set('audience', nullable(ev.target.value))} />
              </Field>
              <Field label="Condições de inscrição">
                <input className={inputCls} value={form.booking ?? ''} placeholder="ex.: reserva obrigatória; só membros" onChange={ev => set('booking', nullable(ev.target.value))} />
              </Field>
              <Field label="Adesão obrigatória">
                <select className={inputCls} value={form.membership_required === null ? '' : String(form.membership_required)}
                  onChange={ev => set('membership_required', ev.target.value === '' ? null : ev.target.value === 'true')}>
                  <option value="">Não confirmado</option><option value="true">Sim</option><option value="false">Não</option>
                </select>
              </Field>
              <Field label="Disponibilidade">
                <select className={inputCls} value={form.availability} onChange={ev => set('availability', ev.target.value as EligibilityAvailability)}>
                  {(Object.keys(AVAILABILITY_LABEL) as EligibilityAvailability[]).map(a => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}
                </select>
              </Field>
              <Field label="Custos" hint="Vazio = não confirmado (nunca 'gratuito').">
                <input className={inputCls} value={form.additional_costs ?? ''} onChange={ev => set('additional_costs', nullable(ev.target.value))} />
              </Field>
              <Field label="Data de verificação">
                <input type="date" className={inputCls} value={form.verified_at} onChange={ev => set('verified_at', ev.target.value)} />
              </Field>
            </div>
            <Field label="Notas (opcional)">
              <textarea className={inputCls} rows={2} value={form.notes ?? ''} onChange={ev => set('notes', nullable(ev.target.value))} />
            </Field>
            {issues.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-red-700" data-testid="review-issues">{issues.map((i, k) => <li key={k}>{i}</li>)}</ul>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded border border-gray-300 px-3 py-1.5 text-sm">Cancelar</button>
              <button type="submit" disabled={submit.isPending} className="rounded bg-vivere-teal px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {submit.isPending ? 'A registar…' : 'Registar revisão'}
              </button>
            </div>
          </form>
        )}

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-500"><History size={13} /> Trilha de auditoria</p>
          {history.isLoading && <p className="text-sm text-gray-400">A carregar…</p>}
          {history.data && history.data.length === 0 && <p className="text-sm text-gray-400">Ainda sem revisões humanas.</p>}
          {history.data && history.data.length > 0 && (
            <ul className="space-y-3">
              {history.data.map(r => (
                <li key={r.id} className="rounded border border-gray-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={TONE[CLASS_LABEL[r.classification].tone]}>{CLASS_LABEL[r.classification].label}</Badge>
                    <span className="text-xs text-gray-500">confiança {CONFIDENCE_LABEL[r.confidence]} · verificada em {r.verified_at} · por {r.reviewed_by} ({r.reviewed_role}) em {new Date(r.reviewed_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-2 text-gray-700">{r.evidence_text}</p>
                  <a href={r.evidence_url} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-vivere-teal hover:underline">{r.evidence_url}</a>
                  <p className="mt-1 text-xs text-gray-500">
                    Público: {r.audience ?? 'não indicado'} · Inscrição: {r.booking ?? 'não indicada'} · Adesão: {r.membership_required === null ? 'não confirmada' : r.membership_required ? 'sim' : 'não'} · Disponibilidade: {AVAILABILITY_LABEL[r.availability]} · Custos: {r.additional_costs ?? 'não confirmados'}
                  </p>
                  {r.notes && <p className="mt-1 text-xs text-gray-500">Notas: {r.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
