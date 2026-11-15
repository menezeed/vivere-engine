/**
 * E4 — checklist de pré-voo da execução assistida. SEM REDE.
 *
 * Verifica, só com o que está na máquina:
 *  1. region_exists   — a região existe em src/config/regions.ts;
 *  2. sources         — só fontes WordPress (sem custo); fontes pagas são
 *                       SEMPRE recusadas nesta fase (L5 por fazer), mesmo
 *                       com --allow-paid; fontes seleccionadas têm de
 *                       pertencer à região;
 *  3. env_target      — envGuard (assertEnvironment, pura): o alvo é o
 *                       staging, nunca a produção. Em dry-run não se aplica;
 *  4. git_clean       — árvore git limpa (o commit do manifesto descreve
 *                       exactamente o código que correu). Aviso em dry-run;
 *  5. rerun_window    — nenhuma execução REAL recente (manifestos locais)
 *                       gravou já a mesma fonte: cada execução abre um
 *                       ingestion_run novo e a Camada A é append-only por
 *                       execução, por isso repetir a mesma janela duplica
 *                       linhas. Só com --force-rerun.
 *
 * Nunca regista valores do ambiente: das falhas do envGuard só guarda o
 * código (por exemplo PRODUCTION_BLOCKED).
 */
import { getRegion, REGIONS, GOOGLE_PLACES_SOURCE_KEY, type RegionDefinition } from '../../config/regions';
import { planRegionSources } from '../runRegionIngestion';
import type { EnvGuardResult } from '../../lib/envGuard';
import type { PreflightCheckRecord, RunManifest } from './runManifest';

/** Fontes com custo por chamada. Recusadas até existir o orçamento persistente (L5). */
export const PAID_SOURCE_KEYS: ReadonlySet<string> = new Set([GOOGLE_PLACES_SOURCE_KEY]);

export const DEFAULT_MIN_RERUN_INTERVAL_HOURS = 20;

export interface PreflightInput {
  region: string;
  /** Subconjunto das fontes da região; vazio/undefined = todas as WordPress da região. */
  sources?: readonly string[];
  dryRun: boolean;
  allowPaid: boolean;
  forceRerun: boolean;
  minRerunIntervalHours?: number;
}

export interface PreflightDeps {
  regions?: readonly RegionDefinition[];
  /** envGuard (pura, sem rede). Lança EnvGuardError se o alvo não for o staging. */
  assertEnvironment: () => EnvGuardResult;
  /** Saída de `git status --porcelain`; null se o git não estiver disponível. */
  gitStatusPorcelain: () => string | null;
  /** Manifestos anteriores (locais). */
  previousManifests: () => readonly RunManifest[];
  /** ISO 8601. */
  now: () => string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheckRecord[];
  region: RegionDefinition | null;
  /** Fontes WordPress que vão correr. */
  runSources: string[];
  /** Fontes da região que NÃO correm, com motivo. */
  skipped: Array<{ source_key: string; reason: string }>;
  targetEnvironment: 'staging' | null;
  gitDirty: boolean | null;
}

const PAID_REFUSAL =
  'API paga: recusada nesta fase. O orçamento persistente (L5: api_usage_log/api_budget_config) não existe; ' +
  'sem ele não há tecto de custo entre execuções.';

export function runPreflight(input: PreflightInput, deps: PreflightDeps): PreflightResult {
  const checks: PreflightCheckRecord[] = [];
  const result: PreflightResult = { ok: false, checks, region: null, runSources: [], skipped: [], targetEnvironment: null, gitDirty: null };

  // 1. Região
  let region: RegionDefinition;
  try {
    region = getRegion(input.region, deps.regions ?? REGIONS);
    checks.push({ id: 'region_exists', status: 'pass', detail: `região "${region.key}" (${region.city_label})` });
  } catch {
    checks.push({ id: 'region_exists', status: 'fail', detail: `região "${input.region}" não existe em src/config/regions.ts` });
    return result;
  }
  result.region = region;

  // 2. Fontes
  const selected = input.sources && input.sources.length > 0 ? [...new Set(input.sources)] : null;
  const sourceProblems: string[] = [];
  if (selected) {
    for (const s of selected) {
      if (PAID_SOURCE_KEYS.has(s)) {
        sourceProblems.push(
          input.allowPaid
            ? `${s}: --allow-paid não tem efeito nesta fase — ${PAID_REFUSAL}`
            : `${s}: ${PAID_REFUSAL} (só fontes WordPress, sem custo)`,
        );
      } else if (!region.sources.includes(s)) {
        sourceProblems.push(`${s}: não pertence à região "${region.key}"`);
      }
    }
  } else if (input.allowPaid && region.sources.some((s) => PAID_SOURCE_KEYS.has(s))) {
    sourceProblems.push(`--allow-paid não tem efeito nesta fase — ${PAID_REFUSAL}`);
  }
  const effectiveRegion: RegionDefinition = { ...region, sources: selected ? region.sources.filter((s) => selected.includes(s)) : region.sources };
  const { planned, refused } = planRegionSources(effectiveRegion);
  result.runSources = planned.map((p) => p.sourceKey);
  result.skipped = [
    ...refused,
    ...region.sources.filter((s) => !effectiveRegion.sources.includes(s)).map((s) => ({ source_key: s, reason: 'não seleccionada (--source)' })),
  ];
  if (sourceProblems.length > 0) {
    checks.push({ id: 'sources', status: 'fail', detail: sourceProblems.join('; ') });
  } else if (planned.length === 0) {
    checks.push({
      id: 'sources',
      status: 'fail',
      detail: `sem fontes WordPress executáveis` + (refused.length ? ` (recusadas: ${refused.map((r) => r.source_key).join(', ')})` : ''),
    });
  } else {
    const paidNote = refused.some((r) => PAID_SOURCE_KEYS.has(r.source_key)) ? '; fontes pagas da região ignoradas (L5)' : '';
    checks.push({ id: 'sources', status: 'pass', detail: `WordPress: ${result.runSources.join(', ')}${paidNote}` });
  }

  // 3. Ambiente alvo (envGuard)
  if (input.dryRun) {
    checks.push({ id: 'env_target', status: 'skip', detail: 'dry-run: nenhum cliente Supabase é criado' });
  } else {
    try {
      const env = deps.assertEnvironment();
      result.targetEnvironment = env.environment;
      checks.push({ id: 'env_target', status: 'pass', detail: `alvo: ${env.environment} (envGuard; produção bloqueada)` });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      const label = typeof code === 'string' ? code : 'ERRO';
      checks.push({
        id: 'env_target',
        status: 'fail',
        detail:
          label === 'PRODUCTION_BLOCKED'
            ? 'envGuard: PRODUCTION_BLOCKED — o alvo é a produção; execução recusada'
            : `envGuard: ${label} — o ambiente não é o staging válido; execução recusada`,
      });
    }
  }

  // 4. Árvore git
  const porcelain = deps.gitStatusPorcelain();
  if (porcelain === null) {
    checks.push({ id: 'git_clean', status: input.dryRun ? 'warn' : 'fail', detail: 'git indisponível: não é possível registar o commit' });
  } else {
    result.gitDirty = porcelain.trim().length > 0;
    if (!result.gitDirty) checks.push({ id: 'git_clean', status: 'pass', detail: 'árvore git limpa' });
    else
      checks.push({
        id: 'git_clean',
        status: input.dryRun ? 'warn' : 'fail',
        detail: `árvore git com alterações (${porcelain.trim().split(/\r?\n/).length} ficheiro(s)); faça commit ou stash antes de uma execução real`,
      });
  }

  // 5. Janela de re-execução
  if (input.dryRun) {
    checks.push({ id: 'rerun_window', status: 'skip', detail: 'dry-run: não grava' });
  } else {
    const hours = input.minRerunIntervalHours ?? DEFAULT_MIN_RERUN_INTERVAL_HOURS;
    const nowMs = Date.parse(deps.now());
    const recent = new Map<string, string>(); // source_key → run_id
    for (const m of deps.previousManifests()) {
      if (m.region !== region.key || m.dry_run) continue;
      const finished = Date.parse(m.finished_at);
      if (Number.isNaN(finished) || nowMs - finished > hours * 3600_000) continue;
      for (const s of m.sources) if (s.status === 'ok' && result.runSources.includes(s.source_key) && !recent.has(s.source_key)) recent.set(s.source_key, m.run_id);
    }
    if (recent.size === 0) {
      checks.push({ id: 'rerun_window', status: 'pass', detail: `nenhuma execução real nas últimas ${hours} h para estas fontes` });
    } else {
      const list = [...recent].map(([s, id]) => `${s} (run ${id})`).join(', ');
      checks.push({
        id: 'rerun_window',
        status: input.forceRerun ? 'warn' : 'fail',
        detail: input.forceRerun
          ? `--force-rerun: re-execução nas últimas ${hours} h (${list}); vai gravar linhas novas na Camada A`
          : `já houve execução real nas últimas ${hours} h: ${list}. Cada execução grava linhas novas (chave por ingestion_run); use --force-rerun só se for intencional`,
      });
    }
  }

  result.ok = checks.every((c) => c.status !== 'fail');
  return result;
}

export function formatPreflight(result: PreflightResult, input: PreflightInput): string {
  const icon = { pass: 'OK  ', fail: 'FALHA', warn: 'AVISO', skip: '--  ' } as const;
  const lines = [`=== Pré-voo: região ${input.region}${input.dryRun ? ' (dry-run)' : ''} ===`];
  for (const c of result.checks) lines.push(`[${icon[c.status]}] ${c.id}: ${c.detail}`);
  lines.push('', result.ok ? 'O que correria:' : 'RECUSADO — nada correria.');
  if (result.ok) {
    lines.push(`  fontes: ${result.runSources.join(', ')}`);
    lines.push(`  modo: ${input.dryRun ? 'dry-run (sem escrita)' : `escrita em ${result.targetEnvironment}`}`);
  }
  for (const s of result.skipped) lines.push(`  ignorada: ${s.source_key} — ${s.reason}`);
  return lines.join('\n');
}
