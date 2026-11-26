/**
 * Leituras de estado do staging para a ingestão FiSH (só --apply).
 *
 * Codex r0, achado 2: as leituras são LIMITADAS às séries do plano (nunca a
 * fonte inteira), com limite explícito e falha se o limite for atingido —
 * não há corte silencioso por paginação. A concorrência é tratada por:
 *   1. recusa se já houver um ingestion_run "running" desta fonte;
 *   2. verificação depois da escrita: uma série com mais de uma linha em
 *      activities_staging falha a execução (exit 1) com a lista.
 * Resíduo: sem um índice único (fonte, série, produto) na BD, dois --apply
 * lançados no mesmo segundo ainda podem duplicar; a verificação 2 detecta-o.
 * O índice único é uma migração e precisa de autorização do PO.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const READ_LIMIT = 1000;

export async function assertSourceExists(db: SupabaseClient, sourceKey: string): Promise<void> {
  const r = await db.from('sources').select('source_key').eq('source_key', sourceKey).limit(1);
  if (r.error) throw new Error(`leitura de sources: ${r.error.message}`);
  if ((r.data ?? []).length === 0) throw new Error(`RECUSA: a fonte ${sourceKey} não existe — correr primeiro scripts/staging/fonte-fish.staging.sql`);
}

export async function assertNoRunningRun(db: SupabaseClient, sourceKey: string): Promise<void> {
  const r = await db.schema('staging').from('ingestion_runs').select('id').eq('source_key', sourceKey).eq('status', 'running').limit(1);
  if (r.error) throw new Error(`leitura de ingestion_runs: ${r.error.message}`);
  if ((r.data ?? []).length > 0) throw new Error(`RECUSA: já existe um ingestion_run "running" para ${sourceKey} (outra execução em curso ou interrompida). Verificar antes de repetir.`);
}

/** Nº de linhas em activities_staging (produto) por série do plano. */
export async function stagedCountsBySeries(
  db: SupabaseClient, sourceKey: string, productKey: string, seriesIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(seriesIds.map(id => [id, 0]));
  if (seriesIds.length === 0) return counts;
  const raw = await db.schema('staging').from('raw_activity_items').select('id, source_item_id')
    .eq('source_key', sourceKey).in('source_item_id', [...seriesIds]).limit(READ_LIMIT);
  if (raw.error) throw new Error(`leitura de raw_activity_items: ${raw.error.message}`);
  const rows = (raw.data ?? []) as Array<{ id: string; source_item_id: string }>;
  if (rows.length >= READ_LIMIT) throw new Error(`RECUSA: ${rows.length} linhas raw para ${seriesIds.length} séries (limite de leitura atingido) — verificar duplicados antes de continuar`);
  if (rows.length === 0) return counts;
  const staged = await db.schema('staging').from('activities_staging').select('raw_activity_item_id')
    .eq('product_key', productKey).in('raw_activity_item_id', rows.map(r => r.id)).limit(READ_LIMIT);
  if (staged.error) throw new Error(`leitura de activities_staging: ${staged.error.message}`);
  const seriesByRaw = new Map(rows.map(r => [r.id, r.source_item_id]));
  for (const s of (staged.data ?? []) as Array<{ raw_activity_item_id: string }>) {
    const id = seriesByRaw.get(s.raw_activity_item_id);
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
