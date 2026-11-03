/**
 * Testes do hook .githooks/pre-commit (SEC-O 3-002).
 *
 * Cada teste cria um repositório Git temporário, põe ficheiros no stage e
 * corre o hook com `sh`. Sem rede: o gitleaks real nunca é chamado — os
 * testes usam GITLEAKS_BIN a apontar para um executável inexistente (modo
 * verificação mínima) ou para um gitleaks falso (script sh).
 *
 * Os valores "secretos" são montados em runtime por concatenação, para que
 * este ficheiro nunca contenha um literal que o gitleaks do CI apanhe.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HOOK = path.resolve(__dirname, '..', '..', '.githooks', 'pre-commit');
const SUBPROCESS_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 60_000;

const hasSh = spawnSync('sh', ['-c', 'exit 0'], { timeout: SUBPROCESS_TIMEOUT_MS }).status === 0;
const hasGit = spawnSync('git', ['--version'], { timeout: SUBPROCESS_TIMEOUT_MS }).status === 0;

// Valores falsos, montados em pedaços.
const FAKE_SB_SECRET = 'sb_' + 'secret_' + 'Q'.repeat(24);
const FAKE_GOOGLE = 'AI' + 'za' + 'B'.repeat(35);
const FAKE_JWT = ['ey' + 'J' + 'h'.repeat(12), 'ey' + 'J' + 'p'.repeat(12), 's'.repeat(16)].join('.');
const FAKE_PRIVATE_KEY = '-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----';

let repo = '';

function git(...args: string[]): void {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: repo, timeout: SUBPROCESS_TIMEOUT_MS, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
}

function stage(file: string, content: string, force = false): void {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  git('add', ...(force ? ['-f'] : []), '--', file);
}

function runHook(env: Record<string, string> = {}): { status: number | null; output: string } {
  const r = spawnSync('sh', [HOOK], {
    cwd: repo,
    timeout: SUBPROCESS_TIMEOUT_MS,
    encoding: 'utf8',
    env: { ...process.env, GITLEAKS_BIN: '__gitleaks_inexistente__', ...env },
  });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe.skipIf(!hasSh || !hasGit)('pre-commit hook (SEC-O)', { timeout: TEST_TIMEOUT_MS }, () => {
  // Um só repositório para todos os testes: `git init` em %TEMP% é lento no
  // Windows. Entre testes só se esvazia o stage.
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'precommit-'));
    git('init', '-q');
  }, TEST_TIMEOUT_MS);

  beforeEach(() => {
    git('read-tree', '--empty');
  }, TEST_TIMEOUT_MS);

  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  describe('sem gitleaks (verificação mínima)', () => {
    it('stage vazio: passa', () => {
      expect(runHook().status).toBe(0);
    });

    it('código normal: passa, com aviso de gitleaks ausente', () => {
      stage('src/ok.ts', 'export const x = 1;\n');
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.output).toContain('gitleaks não encontrado');
    });

    it('.env.example: passa', () => {
      stage('.env.example', 'VIVERE_ENV=staging\nSUPABASE_URL=\n');
      expect(runHook().status).toBe(0);
    });

    it.each([
      ['.env', 'X=1\n'],
      ['.env.production', 'X=1\n'],
      ['admin-panel/.env.development', 'X=1\n'],
      ['.env.production.backup', 'X=1\n'],
      ['keys.txt', 'x\n'],
      ['certs/server.pem', 'x\n'],
      ['certs/server.key', 'x\n'],
      ['id_rsa', 'x\n'],
    ])('ficheiro proibido %s (mesmo com git add -f): bloqueia', (file, content) => {
      stage(file, content, true);
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.output).toContain(file);
    });

    it.each([
      ['chave sb_secret_', `const k = '${FAKE_SB_SECRET}';\n`],
      ['Google API key', `const k = '${FAKE_GOOGLE}';\n`],
      ['JWT', `const k = '${FAKE_JWT}';\n`],
      ['chave privada', `${FAKE_PRIVATE_KEY}\n`],
    ])('%s numa linha adicionada: bloqueia sem imprimir o valor', (_label, content) => {
      stage('src/leak.ts', content);
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.output).toContain('src/leak.ts');
      expect(r.output).not.toContain(content.trim());
    });

    it('fixture com SENTINEL: permitida (mesma regra do .gitleaks.toml)', () => {
      stage('src/__tests__/fixture.test.ts', `const k = '${'sb_' + 'secret_'}SENTINEL0123456789abcdef';\n`);
      expect(runHook().status).toBe(0);
    });
  });

  describe.skipIf(process.platform === 'win32')('com gitleaks (executável falso)', () => {
    function fakeGitleaks(exitCode: number): string {
      // Fica dentro do repo temporário (não entra no stage) e é apagado com ele.
      const bin = path.join(repo, '.fake-gitleaks.sh');
      fs.writeFileSync(bin, `#!/bin/sh\n[ "$1" = "git" ] && [ "$2" = "--help" ] && exit 0\nexit ${exitCode}\n`, { mode: 0o755 });
      return bin;
    }

    it('gitleaks sem achados: passa', () => {
      stage('src/ok.ts', 'export const x = 1;\n');
      expect(runHook({ GITLEAKS_BIN: fakeGitleaks(0) }).status).toBe(0);
    });

    it('gitleaks com achados: bloqueia', () => {
      stage('src/ok.ts', 'export const x = 1;\n');
      const r = runHook({ GITLEAKS_BIN: fakeGitleaks(1) });
      expect(r.status).toBe(1);
      expect(r.output).toContain('gitleaks encontrou');
    });

    it('ficheiro proibido é bloqueado antes do gitleaks', () => {
      stage('.env', 'X=1\n', true);
      expect(runHook({ GITLEAKS_BIN: fakeGitleaks(0) }).status).toBe(1);
    });
  });
});
