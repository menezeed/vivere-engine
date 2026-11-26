/**
 * Público restrito (piloto UK, decisão do PO de 26/11/2026).
 *
 * Actividades para pessoas com demência ou perda de memória entram na fila
 * de revisão CLARAMENTE identificadas: para a pessoa com a condição, para o
 * cuidador ou para ambos. Nunca são aprovadas nem publicadas automaticamente
 * (a guarda de elegibilidade 403 continua a aplicar-se).
 *
 * O valor vem de raw_payload.restricted_audience e só é aceite se for um
 * dos enumerados abaixo; o rótulo é gerado aqui, nunca lido da BD.
 */
export const RESTRICTED_CONDITIONS = ['dementia', 'memory_loss'] as const;
export const RESTRICTED_TARGETS = ['person', 'carer', 'both'] as const;

export interface AudienceRestriction {
  condition: (typeof RESTRICTED_CONDITIONS)[number];
  target: (typeof RESTRICTED_TARGETS)[number];
  label: string;
}

const CONDITION_PT: Record<AudienceRestriction['condition'], string> = {
  dementia: 'pessoa com demência',
  memory_loss: 'pessoa com perda de memória',
};

export function audienceRestrictionLabel(condition: AudienceRestriction['condition'], target: AudienceRestriction['target']): string {
  const who = CONDITION_PT[condition];
  const dest = target === 'both' ? `${who} e cuidador (ambos)` : target === 'carer' ? `cuidador de ${who}` : who;
  return `Público restrito: ${dest}`;
}

/** Valida o valor guardado; qualquer forma desconhecida → null (sem rótulo). */
export function parseAudienceRestriction(raw: unknown): AudienceRestriction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const condition = RESTRICTED_CONDITIONS.find(c => c === r['condition']);
  const target = RESTRICTED_TARGETS.find(t => t === r['target']);
  if (!condition || !target) return null;
  return { condition, target, label: audienceRestrictionLabel(condition, target) };
}
