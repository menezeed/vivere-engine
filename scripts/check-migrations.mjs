// Guarda das migrações (CI). Só lê ficheiros; não liga a nenhuma base.
//
// Verifica:
//  1. Numeração: cada migração é NNNN_nome.sql, sem números repetidos nem
//     buracos na sequência.
//  2. Cada migração tem o par NNNN_nome.rollback.sql (e vice-versa).
//  3. Migrações já aplicadas num ambiente remoto estão congeladas: o SHA-256
//     do conteúdo (fins de linha normalizados para LF, como o git guarda)
//     tem de ser igual ao registado em db/migrations/APPLIED.sha256.
//  4. Migrações transitórias (ex.: 0026, caminho legado aberto durante o
//     rollout) declaram no cabeçalho `-- REVOGAÇÃO DEFINITIVA: NNNN_x.sql`;
//     essa migração tem de existir e ter número maior (não se pode perder a
//     revogação diferida).
//
// Uso: node scripts/check-migrations.mjs [pasta]   (default: db/migrations)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MIG_RX = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const RB_RX = /^(\d{4})_([a-z0-9_]+)\.rollback\.sql$/;

export function sha256Lf(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

export function checkMigrations(dir) {
  const problems = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const migs = new Map();
  const rbs = new Set();
  for (const f of files) {
    const rb = f.match(RB_RX);
    if (rb) { rbs.add(`${rb[1]}_${rb[2]}`); continue; }
    const m = f.match(MIG_RX);
    if (!m) { problems.push(`nome inválido: ${f} (esperado NNNN_nome.sql ou NNNN_nome.rollback.sql)`); continue; }
    if (migs.has(m[1])) problems.push(`número repetido ${m[1]}: ${migs.get(m[1])} e ${f}`);
    else migs.set(m[1], `${m[1]}_${m[2]}`);
  }
  const nums = [...migs.keys()].map(Number).sort((a, b) => a - b);
  nums.forEach((n, i) => { if (n !== i) problems.push(`sequência com buraco: esperado ${String(i).padStart(4, '0')}, encontrado ${String(n).padStart(4, '0')}`); });
  for (const base of migs.values()) if (!rbs.has(base)) problems.push(`sem rollback: ${base}.sql`);
  const bases = new Set(migs.values());
  for (const base of rbs) if (!bases.has(base)) problems.push(`rollback sem migração: ${base}.rollback.sql`);

  for (const base of migs.values()) {
    const text = readFileSync(join(dir, `${base}.sql`), 'utf8');
    for (const m of text.matchAll(/^--\s*REVOGAÇÃO DEFINITIVA:\s*(\d{4})_([a-z0-9_]+)\.sql/gm)) {
      const target = `${m[1]}_${m[2]}`;
      if (!bases.has(target)) problems.push(`${base}.sql é transitória mas a revogação ${target}.sql não existe`);
      else if (Number(m[1]) <= Number(base.slice(0, 4))) problems.push(`${base}.sql: a revogação ${target}.sql tem de vir depois`);
    }
  }

  const manifest = join(dir, 'APPLIED.sha256');
  if (!existsSync(manifest)) problems.push('APPLIED.sha256 em falta');
  else {
    for (const line of readFileSync(manifest, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const m = t.match(/^([0-9a-f]{64})\s+(\S+\.sql)(?:\s+.*)?$/);
      if (!m) { problems.push(`APPLIED.sha256: linha inválida: ${t}`); continue; }
      const p = join(dir, m[2]);
      if (!existsSync(p)) { problems.push(`aplicada mas em falta: ${m[2]}`); continue; }
      const got = sha256Lf(readFileSync(p, 'utf8'));
      if (got !== m[1]) problems.push(`migração aplicada foi alterada: ${m[2]} (esperado ${m[1].slice(0, 12)}…, obtido ${got.slice(0, 12)}…)`);
    }
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = resolve(process.argv[2] ?? 'db/migrations');
  const problems = checkMigrations(dir);
  if (problems.length) {
    console.error(`check-migrations: ${problems.length} problema(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('check-migrations: OK');
}
