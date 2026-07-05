export interface SourceStatus {
  source_key: string;
  last_status: string;
  last_run_at: string;
  last_run_items: number;
  last_run_errors: number;
  duration_ms: number | null;
}

export interface PlatformStats {
  venues: {
    pending_review: number;
    approved: number;
    rejected: number;
    promoted: number;
    total: number;
  };
  activities: {
    pending_review: number;
    approved: number;
    rejected: number;
    promoted: number;
    total: number;
    unresolved_venue: number;
  };
  ingestion: {
    last_run_at: string | null;
    last_run_source: string | null;
    last_run_items: number | null;
    last_run_status: string | null;
    runs_this_month: number;
    by_source: SourceStatus[];
  };
  budget: {
    monthly_limit_usd: number;
    estimated_spent_usd: number;
    estimated_remaining_usd: number;
    usage_pct: number;
    alert: boolean;
  };
}

export interface IngestionRun {
  id: string;
  source_key: string;
  status: 'running' | 'success' | 'failed' | 'partial';
  items_collected: number;
  items_errored: number;
  started_at: string;
  finished_at: string | null;
}
