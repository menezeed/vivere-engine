/**
 * E4 — lock local por região: impede duas execuções assistidas
 * simultâneas da MESMA região na mesma máquina.
 *
 * - Criação atómica (`open(..., 'wx')`): só um processo cria o ficheiro.
 * - Conteúdo: { region, run_id, pid, acquired_at } — nada de ambiente,
 *   nomes de máquina ou utilizadores.
 * - Lock obsoleto (stale): o processo dono já não existe, OU o lock tem
 *   mais de `staleAfterMs` (por omissão 6 h, igual a maxRunningHours do
 *   E7). Um lock obsoleto é removido e a aquisição repete-se UMA vez.
 * - Um lock ilegível (por exemplo, a meio da escrita) conta como ocupado,
 *   excepto se o ficheiro for mais velho do que `staleAfterMs`.
 * - release() só apaga o lock se ainda for o desta execução.
 *
 * Limite assumido: é um lock LOCAL. Duas máquinas diferentes não se vêem;
 * no GitHub Actions o equivalente é `concurrency` por região.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LockInfo {
  region: string;
  run_id: string;
  pid: number;
  acquired_at: string;
}

export interface LockOptions {
  /** Directório dos locks (por exemplo runs/locks). */
  dir: string;
  region: string;
  runId: string;
  pid?: number;
  /** Relógio injectado (ms desde a época). */
  nowMs?: () => number;
  staleAfterMs?: number;
  /** Por omissão: process.kill(pid, 0). */
  isProcessAlive?: (pid: number) => boolean;
}

export interface RegionLock {
  readonly path: string;
  readonly info: LockInfo;
  /** Locks obsoletos removidos para adquirir este. */
  readonly replacedStale: LockInfo | null;
  release(): void;
}

export const DEFAULT_LOCK_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export class RegionLockedError extends Error {
  readonly holder: LockInfo | null;
  constructor(region: string, holder: LockInfo | null) {
    super(
      `[run-lock] já existe uma execução em curso para a região "${region}"` +
        (holder ? ` (run ${holder.run_id}, pid ${holder.pid}, desde ${holder.acquired_at})` : ' (lock ilegível)') +
        '. Espere que termine; se tiver a certeza de que não está a correr, apague o lock em runs/locks/.',
    );
    this.name = 'RegionLockedError';
    this.holder = holder;
  }
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: existe, mas pertence a outro utilizador.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockPathFor(dir: string, region: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(region)) throw new Error(`[run-lock] chave de região inválida: "${region}"`);
  return path.join(dir, `${region}.lock`);
}

function readLock(file: string): LockInfo | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<LockInfo>;
    if (typeof parsed.run_id !== 'string' || typeof parsed.pid !== 'number' || typeof parsed.acquired_at !== 'string') return null;
    return parsed as LockInfo;
  } catch {
    return null;
  }
}

function tryCreate(file: string, info: LockInfo): boolean {
  let fd: number;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify(info));
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

export function acquireRegionLock(options: LockOptions): RegionLock {
  const nowMs = options.nowMs ?? (() => Date.now());
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_LOCK_STALE_AFTER_MS;
  const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  fs.mkdirSync(options.dir, { recursive: true });
  const file = lockPathFor(options.dir, options.region);
  const info: LockInfo = {
    region: options.region,
    run_id: options.runId,
    pid: options.pid ?? process.pid,
    acquired_at: new Date(nowMs()).toISOString(),
  };

  let replacedStale: LockInfo | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (tryCreate(file, info)) {
      return {
        path: file,
        info,
        replacedStale,
        release: () => {
          const current = readLock(file);
          if (current && current.run_id === info.run_id) fs.rmSync(file, { force: true });
        },
      };
    }
    const holder = readLock(file);
    let stale: boolean;
    if (holder) {
      const age = nowMs() - Date.parse(holder.acquired_at);
      stale = !isAlive(holder.pid) || Number.isNaN(age) || age > staleAfterMs;
    } else {
      let mtimeMs: number;
      try {
        mtimeMs = fs.statSync(file).mtimeMs;
      } catch {
        continue; // desapareceu entretanto: tentar de novo
      }
      stale = nowMs() - mtimeMs > staleAfterMs;
    }
    if (!stale || attempt === 1) throw new RegionLockedError(options.region, holder);
    replacedStale = holder;
    fs.rmSync(file, { force: true });
  }
  throw new RegionLockedError(options.region, readLock(file));
}
