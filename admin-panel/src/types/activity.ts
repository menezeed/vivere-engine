import type { ProposalStatus } from './review';
import type { EligibilityDetail, EligibilitySummary } from './eligibility';

export interface ActivityStagingItem {
  id: string;
  raw_activity_item_id: string;
  product_key: string;
  proposal_status: ProposalStatus;
  venue_resolution_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
  promoted_activity_id: string | null;
  created_at: string;
  title?: string;
  description?: string | null;
  source_key?: string;
  image_url?: string | null;
  external_url?: string | null;
  venue_mention_raw_text?: string | null;
  venue_mention_confidence_hint?: string | null;
  occurrences?: Array<{ date: string; time: string | null; end_date: string | null; end_time: string | null }>;
  raw_payload?: Record<string, unknown>;
  /** Chave estável na fonte (ex.: "group:270"). */
  source_item_id?: string | null;
  /**
   * Público restrito (piloto UK): para a pessoa com demência / perda de
   * memória, para o cuidador ou para ambos. Rótulo gerado pela Review API.
   */
  audience_restriction?: {
    condition: 'dementia' | 'memory_loss';
    target: 'person' | 'carer' | 'both';
    label: string;
  } | null;
  /**
   * Issue #62: elegibilidade 60+ auditada. Lista → resumo; detalhe → completo.
   * null = produto sem auditoria; ausente = flag desligada na Review API.
   */
  eligibility?: EligibilitySummary | EligibilityDetail | null;
}
// ActivityListResponse removido — usar ListResponse<ActivityStagingItem> de @/types/api
