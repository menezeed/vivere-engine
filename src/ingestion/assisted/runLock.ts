/**
 * E4 — lock local por região: impede duas execuções assistidas
 * simultâneas da MESMA região na mesma máquina.
 *
 * - Criação atómica (`open(..., 'wx')`): só um processo cria o ficheiro.
 * - Conteúdo: { region, run_id, pid, acquired_at } — nada de ambiente,
 *   nomes de máquina ou utilizadores.
 * - Lock obsoleto (stale) — recuperado automaticamente SÓ quando:
 *     a) o processo dono já não existe; ou
 *     b) o lock é ilegível/corrompido E o ficheiro tem mais de
 *        `staleAfterMs` (por omissão 6 h, igual a maxRunningHours do E7).
 * - Um lock cujo processo dono está VIVO nunca é recuperado
 *   automaticamente, por mais antigo que seja: exige intervenção manual
 *   (RegionLockedError com reason 'old_live_owner').
 * - Recuperação atómica: sob um lock de recuperação exclusivo
 *   (`<lock>.recover`, criado com 'wx'), o lock é relido e só é apagado se
 *   for EXACTAMENTE o observado (mesmo conteúdo e mtime). Assim, se duas
 *   execuções virem o mesmo órfão, a segunda nunca apaga o lock novo da
 *   primeira. Um `.recover` existente (recuperação em curso ou
 *   interrompida) faz a aquisição falhar — nunca é removido sozinho.
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
  /** Só para testes: chamado depois de observar um lock obsoleto e antes de o recuperar. */
  onStaleObserved?: () => void;
}

export interface RegionLock {
  readonly path: string;
  readonly info: LockInfo;
  /** Lock obsoleto removido para adquirir este (null se ilegível ou nenhum). */
  readonly replacedStale: LockInfo | null;
  release(): void;
}

export const DEFAULT_LOCK_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export type RegionLockedReason = 'live_owner' | 'old_live_owner' | 'unreadable' | 'recovery_in_progress';

export class RegionLockedError extends Error {
  readonly holder: LockInfo | null;
  readonly reason: RegionLockedReason;
  constructor(region: string, holder: LockInfo | null, reason: RegionLockedReason = holder ? 'live_owner' : 'unreadable') {
    const who = holder ? ` (run ${holder.run_id}, pid ${holder.pid}, desde ${holder.acquired_at})` : '';
    const detail: Record<RegionLockedReason, string> = {
      live_owner: `já existe uma execução em curso para a região "${region}"${who}. Espere que termine.`,
      old_live_owner:
        `o lock da região "${region}"${who} é antigo, mas o processo dono continua VIVO: não é recuperado automaticamente. ` +
        'Intervenção manual: confirme se essa execução está pendurada, termine-a e só então apague o lock em runs/locks/.',
      unreadable: `o lock da região "${region}" está ilegível e é recente; pode estar a ser escrito. Tente de novo; se persistir, apague-o em runs/locks/.`,
      recovery_in_progress:
        `há uma recuperação de lock em curso (ou interrompida) para a região "${region}". ` +
        `Tente de novo; se persistir e nenhuma execução estiver a correr, apague runs/locks/${region}.lock.recover.`,
    };
    super(`[run-lock] ${detail[reason]}`);
    this.name = 'RegionLockedError';
    this.holder = holder;
    this.reason = reason;
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

function parseLock(raw: string): LockInfo | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (typeof parsed.run_id !== 'string' || typeof parsed.pid !== 'number' || typeof parsed.acquired_at !== 'string') return null;
    return parsed as LockInfo;
  } catch {
    return null;
  }
}

interface Observation {
  raw: string;
  mtimeMs: number;
  info: LockInfo | null;
}

/** Lê o lock tal como está agora; null se não existir. */
function observe(file: string): Observation | null {
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    const raw = fs.readFileSync(file, 'utf8');
    return { raw, mtimeMs, info: parseLock(raw) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function tryCreate(file: string, content: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

/**
 * Remove o lock obsoleto SÓ se ainda for exactamente o observado, sob o
 * lock de recuperação exclusivo. Devolve true se o removeu.
 */
function recoverStale(file: string, observed: Observation, region: string, me: LockInfo): boolean {
  const recoverFile = `${file}.recover`;
  if (!tryCreate(recoverFile, JSON.stringify(me))) throw new RegionLockedError(region, observed.info, 'recovery_in_progress');
  try {
    const current = observe(file);
    if (!current || current.raw !== observed.raw || current.mtimeMs !== observed.mtimeMs) return false;
    fs.rmSync(file, { force: true });
    return true;
  } finally {
    fs.rmSync(recoverFile, { force: true });
  }
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
  let lastSeen: LockInfo | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (tryCreate(file, JSON.stringify(info))) {
      return {
        path: file,
        info,
        replacedStale,
        release: () => {
          const current = observe(file);
          if (current?.info && current.info.run_id === info.run_id) fs.rmSync(file, { force: true });
        },
      };
    }
    const observed = observe(file);
    if (!observed) continue; // desapareceu entretanto: tentar de novo
    lastSeen = observed.info;
    if (observed.info) {
      if (isAlive(observed.info.pid)) {
        const age = nowMs() - Date.parse(observed.info.acquired_at);
        throw new RegionLockedError(options.region, observed.info, age > staleAfterMs ? 'old_live_owner' : 'live_owner');
      }
    } else if (nowMs() - observed.mtimeMs <= staleAfterMs) {
      throw new RegionLockedError(options.region, null, 'unreadable');
    }
    options.onStaleObserved?.();
    if (recoverStale(file, observed, options.region, info)) replacedStale = observed.info;
  }
  throw new RegionLockedError(options.region, lastSeen);
}
