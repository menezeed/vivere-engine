/**
 * scripts/run-assisted.ts — E4: execução manual ASSISTIDA de uma região.
 *
 *   npx tsx --env-file=<ficheiro fora do repo> scripts/run-assisted.ts --region <key> [opções]
 *
 * Opções:
 *   --preflight          só o checklist (sem rede, sem lock, sem manifesto)
 *   --dry-run            recolhe e calcula L4/E7 sem cliente Supabase
 *   --source <key>       restringe às fontes indicadas (repetível)
 *   --since-days=N       janela de recolha (dias)
 *   --allow-paid         aceite, mas SEM efeito nesta fase: fontes pagas são sempre recusadas (L5)
 *   --force-rerun        permite repetir uma execução real recente (grava linhas novas)
 *
 * Grava um manifesto auditável em runs/manifests/<run_id>.json (ignorado
 * pelo git) e usa um lock por região em runs/locks/. Procedimento
 * completo: docs/operacao/agendador/RUNBOOK-EXECUCAO-ASSISTIDA.md.
 *
 * Código de saída: 0 ok; 1 fonte falhada ou erro; 2 saúde 'critical'; 3 recusado.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnvironment } from '../src/lib/envGuard';
import { readRunManifests } from '../src/ingestion/assisted/runManifest';
import { runAssistedIngestion, EXIT_REFUSED, type AssistedRunArgs } from '../src/ingestion/assisted/runAssisted';
import { defaultDeps } from './ingest-region';

export function parseRunAssistedArgs(argv: readonly string[]): AssistedRunArgs {
  let region: string | undefined;
  let sinceDays: number | undefined;
  const sources: string[] = [];
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--region') region = argv[++i];
    else if (a.startsWith('--region=')) region = a.slice('--region='.length);
    else if (a === '--source') {
      const s = argv[++i];
      if (!s || s.startsWith('--')) throw new Error('--source exige uma source_key');
      sources.push(s);
    } else if (a.startsWith('--source=')) sources.push(a.slice('--source='.length));
    else if (a.startsWith('--since-days=')) {
      sinceDays = Number(a.slice('--since-days='.length));
      if (!Number.isInteger(sinceDays) || sinceDays <= 0) throw new Error('--since-days tem de ser um inteiro positivo');
    } else if (['--preflight', '--dry-run', '--allow-paid', '--force-rerun'].includes(a)) flags.add(a);
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!region || region.startsWith('--')) throw new Error('falta --region <key>');
  return {
    region,
    sources,
    sinceDays,
    dryRun: flags.has('--dry-run'),
    allowPaid: flags.has('--allow-paid'),
    forceRerun: flags.has('--force-rerun'),
    preflightOnly: flags.has('--preflight'),
  };
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_DIR = path.join(REPO_ROOT, 'runs');
const MANIFESTS_DIR = path.join(RUNS_DIR, 'manifests');

/** Comandos git LOCAIS (sem rede). null se o git não estiver disponível. */
function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  let args: AssistedRunArgs;
  try {
    args = parseRunAssistedArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT_REFUSED;
  }
  const out = await runAssistedIngestion(args, {
    ingestion: defaultDeps,
    preflight: {
      assertEnvironment: () => assertEnvironment(),
      gitStatusPorcelain: () => git(['status', '--porcelain']),
      previousManifests: () => readRunManifests(MANIFESTS_DIR),
      now: () => new Date().toISOString(),
    },
    manifestsDir: MANIFESTS_DIR,
    locksDir: path.join(RUNS_DIR, 'locks'),
    gitCommit: () => git(['rev-parse', 'HEAD'])?.trim() || null,
    randomSuffix: () => randomBytes(3).toString('hex'),
  });
  console.log(out.text);
  return out.exitCode;
}

// Só corre como CLI, nunca quando importado por um teste.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, '<url>') : String(err));
      process.exit(1);
    });
}
