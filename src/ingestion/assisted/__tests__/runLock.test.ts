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

  it('lock obsoleto por idade (> staleAfterMs) é substituído mesmo com o pid vivo', () => {
    acquireRegionLock({ dir, region: 'buzios', runId: 'old', pid: 111, nowMs: () => T0, isProcessAlive: alive });
    const later = () => T0 + DEFAULT_LOCK_STALE_AFTER_MS + 1;
    const b = acquireRegionLock({ dir, region: 'buzios', runId: 'new', pid: 222, nowMs: later, isProcessAlive: alive });
    expect(b.replacedStale?.run_id).toBe('old');
    b.release();
  });

  it('lock ilegível e recente conta como ocupado', () => {
    fs.writeFileSync(path.join(dir, 'buzios.lock'), '');
    expect(() => acquireRegionLock({ dir, region: 'buzios', runId: 'x', nowMs: () => Date.now(), isProcessAlive: dead })).toThrow(/lock ilegível/);
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
