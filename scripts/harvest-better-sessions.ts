/**
 * Harvester incremental do feed RPDE scheduled-sessions da Better (OpenActive,
 * CC BY 4.0) — piloto UK, SÓ LEITURA, sem BD.
 *
 * O feed é nacional e muito grande: lê no máximo --max-pages páginas por
 * execução (omissão e tecto: 60), 3 s entre pedidos, pára em HTTP 429/403.
 * Guarda depois de CADA página um estado compacto (cursor + sessões das
 * séries de Richmond do snapshot); a execução seguinte retoma do cursor.
 * Nunca guarda páginas inteiras nem texto livre.
 *
 *   npx tsx scripts/harvest-better-sessions.ts [--snapshot=<better-preview.json>] [--state=<better-sessions-state.json>] [--max-pages=60]
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BETTER_CONFIG } from '../src/collectors/openactive-better/config';
import { parseBetterSnapshot } from '../src/collectors/openactive-better/betterFeed';
import {
  applySessionsPage, newState, parseSessionsState, SESSIONS_FEED_URL, type HarvestRun, type SessionsState,
} from '../src/collectors/openactive-better/betterSessions';

const DEFAULT_DIR = 'C:/Projects/Vivere/reviews/piloto-uk';
export const MAX_PAGES_CAP = 60;
const arg = (argv: readonly string[], name: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export type FetchText = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; text: () => Promise<string> }>;

function save(path: string, state: SessionsState): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 1));
  renameSync(`${path}.tmp`, path);
}

export async function main(
  argv: readonly string[] = process.argv,
  deps: { fetchText?: FetchText; sleep?: (ms: number) => Promise<void>; log?: (s: string) => void } = {},
): Promise<SessionsState> {
  const snapshotPath = arg(argv, 'snapshot') ?? `${DEFAULT_DIR}/better-preview-2026-11-26.json`;
  const statePath = arg(argv, 'state') ?? `${DEFAULT_DIR}/better-sessions-state.json`;
  const maxPagesArg = Number(arg(argv, 'max-pages') ?? MAX_PAGES_CAP);
  if (!Number.isInteger(maxPagesArg) || maxPagesArg < 1) throw new Error('--max-pages tem de ser um inteiro >= 1');
  const maxPages = Math.min(maxPagesArg, MAX_PAGES_CAP);
  const fetchText: FetchText = deps.fetchText ?? (async (url, init) => { const r = await fetch(url, init); return { status: r.status, text: () => r.text() }; });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const log = deps.log ?? ((s: string) => console.log(s));

  const snapshot = parseBetterSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')));
  const seriesIds = snapshot.series.map(s => s.identifier);
  let state: SessionsState;
  if (existsSync(statePath)) {
    state = parseSessionsState(JSON.parse(readFileSync(statePath, 'utf8')));
    const same = state.series_ids.length === new Set(seriesIds).size && seriesIds.every(id => state.series_ids.includes(id));
    if (!same) throw new Error('RECUSA: o estado foi criado com outro conjunto de séries; usar outro --state');
  } else {
    state = newState(seriesIds);
  }

  const run: HarvestRun = { started_at: new Date().toISOString(), finished_at: null, pages: 0, bytes: 0, http_statuses: {}, stop_reason: null };
  state.runs.push(run);
  let url = state.cursor;
  for (let i = 0; i < maxPages; i++) {
    if (i > 0) await sleep(BETTER_CONFIG.min_interval_ms);
    const res = await fetchText(url, { headers: { 'User-Agent': BETTER_CONFIG.user_agent, Accept: 'application/json' } });
    run.http_statuses[String(res.status)] = (run.http_statuses[String(res.status)] ?? 0) + 1;
    if (res.status === 429 || res.status === 403) { run.stop_reason = `http_${res.status}`; break; }
    if (res.status !== 200) { run.stop_reason = `http_${res.status}`; break; }
    const body = await res.text();
    const bytes = Buffer.byteLength(body, 'utf8');
    const page = JSON.parse(body) as { items?: unknown; next?: unknown };
    const items = Array.isArray(page.items) ? page.items : [];
    const applied = applySessionsPage(state, items);
    run.items_with_series_id = (run.items_with_series_id ?? 0) + applied.parsed;
    run.sessions_kept = (run.sessions_kept ?? 0) + applied.kept;
    if (run.pages === 0 && items.length > 0 && applied.parsed === 0) { run.stop_reason = 'superevent_format_unrecognised'; save(statePath, state); break; }
    run.pages++; run.bytes += bytes; state.pages_read_total++; state.bytes_total += bytes;
    const next = typeof page.next === 'string' ? new URL(page.next, url).toString() : null;
    if (items.length === 0 || next === null || next === url) {
      state.reached_end = true; run.stop_reason = 'end_of_feed';
      save(statePath, state);
      break;
    }
    if (!next.startsWith(SESSIONS_FEED_URL)) { run.stop_reason = 'foreign_next_url'; save(statePath, state); break; }
    url = next; state.cursor = next; state.reached_end = false;
    save(statePath, state);
    if (run.pages % 10 === 0) log(`páginas nesta execução: ${run.pages} (${(run.bytes / 1e6).toFixed(1)} MB); sessões Richmond: ${Object.keys(state.sessions).length}`);
  }
  run.stop_reason ??= 'max_pages';
  run.finished_at = new Date().toISOString();
  save(statePath, state);

  const perSeries: Record<string, number> = {};
  for (const s of Object.values(state.sessions)) perSeries[s.series_id] = (perSeries[s.series_id] ?? 0) + 1;
  log(JSON.stringify({
    execucao: run, reached_end: state.reached_end, cursor: state.cursor,
    total: { paginas: state.pages_read_total, mb: +(state.bytes_total / 1e6).toFixed(1), itens: state.items_read_total },
    sessoes_richmond_por_serie: perSeries,
  }, null, 2));
  return state;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
}
