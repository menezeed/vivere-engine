import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — módulo .mjs sem tipos
import { checkMigrations, sha256Lf } from '../check-migrations.mjs';

function dirWith(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'mig-'));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(d, f), c);
  return d;
}

const ok = {
  '0000_a.sql': 'select 1;\n', '0000_a.rollback.sql': 'select 0;\n',
  '0001_b.sql': 'select 2;\r\n', '0001_b.rollback.sql': 'select 0;\n',
};

describe('check-migrations', () => {
  it('aceita cadeia válida com manifesto (CRLF normalizado)', () => {
    const d = dirWith({ ...ok, 'APPLIED.sha256': `# c\n${sha256Lf('select 2;\n')}  0001_b.sql  staging\n` });
    expect(checkMigrations(d)).toEqual([]);
    rmSync(d, { recursive: true });
  });
  it('detecta migração aplicada alterada', () => {
    const d = dirWith({ ...ok, 'APPLIED.sha256': `${sha256Lf('outra coisa\n')}  0001_b.sql\n` });
    expect(checkMigrations(d).join()).toMatch(/aplicada foi alterada: 0001_b\.sql/);
    rmSync(d, { recursive: true });
  });
  it('detecta rollback em falta, número repetido, buraco e nome inválido', () => {
    const d = dirWith({
      '0000_a.sql': '', '0000_a.rollback.sql': '',
      '0002_c.sql': '', '0002_d.sql': '', '0002_d.rollback.sql': '',
      'x.sql': '', 'APPLIED.sha256': '',
    });
    const p = checkMigrations(d).join('\n');
    expect(p).toMatch(/número repetido 0002/);
    expect(p).toMatch(/buraco/);
    expect(p).toMatch(/nome inválido: x\.sql/);
    expect(p).toMatch(/sem rollback: 0002_c/);
    rmSync(d, { recursive: true });
  });
  it('exige o manifesto', () => {
    const d = dirWith(ok);
    expect(checkMigrations(d)).toContain('APPLIED.sha256 em falta');
    rmSync(d, { recursive: true });
  });
  it('migração transitória exige a revogação diferida, posterior', () => {
    const t = '-- REVOGAÇÃO DEFINITIVA: 0002_rev.sql.\nselect 1;\n';
    const good = dirWith({ ...ok, '0001_b.sql': t, '0002_rev.sql': '', '0002_rev.rollback.sql': '', 'APPLIED.sha256': '' });
    expect(checkMigrations(good)).toEqual([]);
    rmSync(good, { recursive: true });
    const missing = dirWith({ ...ok, '0001_b.sql': t, 'APPLIED.sha256': '' });
    expect(checkMigrations(missing).join()).toMatch(/transitória mas a revogação 0002_rev\.sql não existe/);
    rmSync(missing, { recursive: true });
    const before = dirWith({ ...ok, '0001_b.sql': '-- REVOGAÇÃO DEFINITIVA: 0000_a.sql\n', 'APPLIED.sha256': '' });
    expect(checkMigrations(before).join()).toMatch(/tem de vir depois/);
    rmSync(before, { recursive: true });
  });
  it('a cadeia real do repositório passa', () => {
    expect(checkMigrations(fileURLToPath(new URL('../../db/migrations', import.meta.url)))).toEqual([]);
  });
});
