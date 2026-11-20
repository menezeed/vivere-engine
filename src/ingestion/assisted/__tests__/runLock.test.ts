import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { acquireRegionLock, RegionLockedError, DEFAULT_LOCK_STALE_AFTER_MS } from '../runLock';

let dir: string;
const T0 = Date.parse('2026-11-14T12:00:00.000Z');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e4-lock-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const alive = () => true;
const dead = () => false;

describe('acquireRegionLock', () => {
  it('impede uma segunda execução simultânea da mesma região', () => {
    const a = acquireRegionLock({ dir, region: 'buzios', runId: 'run-a', pid: 111, nowMs: () => T0, isProcessAlive: alive });
    expect(() => acquireRegionLock({ dir, region: 'buzios', runId: 'run-b', pid: 222, nowMs: () => T0, isProcessAlive: alive })).toThrow(RegionLockedError);
    try {
      acquireRegionLock({ dir, region: 'buzios', runId: 'run-b', pid: 222, nowMs: () => T0, isProcessAlive: alive });
    } catch (err) {
      expect((err as RegionLockedError).holder).toMatchObject({ run_id: 'run-a', pid: 111 });
    }
    a.release();
    const b = acquireRegionLock({ dir, region: 'buzios', runId: 'run-b', pid: 222, nowMs: () => T0, isProcessAlive: alive });
    expect(b.info.run_id).toBe('run-b');
    b.release();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('regiões diferentes não se bloqueiam', () => {
    const a = acquireRegionLock({ dir, region: 'buzios', runId: 'r1', nowMs: () => T0, isProcessAlive: alive });
    const b = acquireRegionLock({ dir, region: 'cabo_frio', runId: 'r2', nowMs: () => T0, isProcessAlive: alive });
    a.release();
    b.release();
  });

  it('lock obsoleto por processo morto é substituído', () => {
    acquireRegionLock({ dir, region: 'buzios', runId: 'old', pid: 111, nowMs: () => T0, isProcessAlive: alive }); // nunca libertado
    const b = acquireRegionLock({ dir, region: 'buzios', runId: 'new', pid: 222, nowMs: () => T0, isProcessAlive: dead });
    expect(b.replacedStale).toMatchObject({ run_id: 'old' });
    b.release();
  });

  it('lock antigo (> staleAfterMs) com o pid VIVO nunca é recuperado: exige intervenção manual', () => {
    const old = acquireRegionLock({ dir, region: 'buzios', runId: 'old', pid: 111, nowMs: () => T0, isProcessAlive: alive });
    const later = () => T0 + DEFAULT_LOCK_STALE_AFTER_MS + 1;
    let caught: unknown;
    try {
      acquireRegionLock({ dir, region: 'buzios', runId: 'new', pid: 222, nowMs: later, isProcessAlive: alive });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RegionLockedError);
    expect((caught as RegionLockedError).reason).toBe('old_live_owner');
    expect((caught as RegionLockedError).message).toMatch(/continua VIVO.*Intervenção manual/);
    expect(JSON.parse(fs.readFileSync(old.path, 'utf8')).run_id).toBe('old'); // intacto
    old.release();
  });

  it('lock antigo com o pid morto é recuperado', () => {
    acquireRegionLock({ dir, region: 'buzios', runId: 'old', pid: 111, nowMs: () => T0, isProcessAlive: alive });
    const later = () => T0 + DEFAULT_LOCK_STALE_AFTER_MS + 1;
    const b = acquireRegionLock({ dir, region: 'buzios', runId: 'new', pid: 222, nowMs: later, isProcessAlive: (p) => p !== 111 });
    expect(b.replacedStale?.run_id).toBe('old');
    b.release();
  });

  it('lock ilegível e recente conta como ocupado', () => {
    fs.writeFileSync(path.join(dir, 'buzios.lock'), '');
    expect(() => acquireRegionLock({ dir, region: 'buzios', runId: 'x', nowMs: () => Date.now(), isProcessAlive: dead })).toThrow(/ilegível/);
  });

  it('lock ilegível mais antigo do que staleAfterMs é recuperado', () => {
    fs.writeFileSync(path.join(dir, 'buzios.lock'), '{corrompido');
    const b = acquireRegionLock({ dir, region: 'buzios', runId: 'x', nowMs: () => Date.now() + DEFAULT_LOCK_STALE_AFTER_MS + 60_000, isProcessAlive: alive });
    expect(b.replacedStale).toBeNull();
    expect(JSON.parse(fs.readFileSync(b.path, 'utf8')).run_id).toBe('x');
    b.release();
  });

  it('recuperação concorrente (B e C vêem o mesmo órfão): C nunca apaga o lock novo de B', () => {
    const ORPHAN_PID = 111;
    const isAlive = (pid: number) => pid !== ORPHAN_PID;
    acquireRegionLock({ dir, region: 'buzios', runId: 'orfao', pid: ORPHAN_PID, nowMs: () => T0, isProcessAlive: alive }); // nunca libertado
    let b: ReturnType<typeof acquireRegionLock> | undefined;
    // C observa o órfão; antes de C o recuperar, B observa-o, recupera-o e cria o seu lock.
    const c = () =>
      acquireRegionLock({
        dir,
        region: 'buzios',
        runId: 'C',
        pid: 333,
        nowMs: () => T0,
        isProcessAlive: isAlive,
        onStaleObserved: () => {
          if (!b) b = acquireRegionLock({ dir, region: 'buzios', runId: 'B', pid: 222, nowMs: () => T0, isProcessAlive: isAlive });
        },
      });
    expect(c).toThrow(RegionLockedError);
    expect(b!.replacedStale?.run_id).toBe('orfao');
    expect(JSON.parse(fs.readFileSync(b!.path, 'utf8')).run_id).toBe('B');
    expect(fs.existsSync(`${b!.path}.recover`)).toBe(false);
    b!.release();
  });

  it('recuperação de outro processo em curso (.recover presente) → recusado, nada apagado', () => {
    acquireRegionLock({ dir, region: 'buzios', runId: 'orfao', pid: 111, nowMs: () => T0, isProcessAlive: alive });
    fs.writeFileSync(path.join(dir, 'buzios.lock.recover'), '{}');
    let caught: unknown;
    try {
      acquireRegionLock({ dir, region: 'buzios', runId: 'x', pid: 2, nowMs: () => T0, isProcessAlive: dead });
    } catch (err) {
      caught = err;
    }
    expect((caught as RegionLockedError).reason).toBe('recovery_in_progress');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'buzios.lock'), 'utf8')).run_id).toBe('orfao');
  });

  it('release() não apaga o lock de outra execução', () => {
    const a = acquireRegionLock({ dir, region: 'buzios', runId: 'a', pid: 1, nowMs: () => T0, isProcessAlive: alive });
    const b = acquireRegionLock({ dir, region: 'buzios', runId: 'b', pid: 2, nowMs: () => T0, isProcessAlive: dead }); // substitui 'a' (pid morto)
    a.release();
    expect(JSON.parse(fs.readFileSync(b.path, 'utf8')).run_id).toBe('b');
    b.release();
  });

  it('chave de região inválida (path traversal) é recusada', () => {
    expect(() => acquireRegionLock({ dir, region: '../x', runId: 'r' })).toThrow(/inválida/);
  });

  it('o ficheiro de lock só tem region, run_id, pid e acquired_at', () => {
    const a = acquireRegionLock({ dir, region: 'buzios', runId: 'r', pid: 5, nowMs: () => T0 });
    expect(Object.keys(JSON.parse(fs.readFileSync(a.path, 'utf8'))).sort()).toEqual(['acquired_at', 'pid', 'region', 'run_id']);
    a.release();
  });
});
