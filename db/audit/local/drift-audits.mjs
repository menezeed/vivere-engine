// SEC-O-019B: deriva entre duas auditorias do MESMO ambiente (ex.: SEC-O-017 vs preflight).
// Local; não liga a nada. Uso: node drift-audits.mjs <antiga> <nova>
// Normaliza o que é só formato (BOM, CRLF/LF, aspas CSV, espaços finais, ordem das linhas,
// CSV vs texto) e classifica cada diferença real por secção.
import { readFileSync } from 'node:fs';
function load(f) {
  const raw = readFileSync(f, 'utf8').replace(/^﻿/, '');
  let rows;
  if (/^"?sec"?,"?objeto"?,/.test(raw)) {
    rows = []; let row = [], x = '', q = false;
    for (let i = 0; i < raw.length; i++) { const c = raw[i];
      if (q) { if (c === '"' && raw[i + 1] === '"') { x += '"'; i++; } else if (c === '"') q = false; else x += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(x); x = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && raw[i + 1] === '\n') i++; row.push(x); rows.push(row); row = []; x = ''; } else x += c; }
    if (x || row.length) { row.push(x); rows.push(row); }
    rows = rows.slice(1);
  } else rows = raw.split(/\r?\n/).filter((l) => / \| /.test(l) && !/^sec \| /.test(l)).map((l) => { const p = l.split(' | '); return [p[0], p[1], p[2], p.slice(3, -1).join(' | '), p.at(-1)]; });
  return rows.filter((r) => r.length === 5).map((r) => r.map((v) => v.trim()));
}
// Classificação por secção da auditoria
const CLASS = {
  'V versao': ['INFO', 'versão do servidor (não muda privilégios; rever se mudar)'],
  'A rls': ['SEGURANCA', 'RLS/FORCE/nº de políticas/dono/opções das vistas'],
  'B privs': ['SEGURANCA', 'privilégios efectivos'],
  'C colunas': ['SEGURANCA', 'privilégios de coluna'],
  'L acl': ['SEGURANCA', 'entradas de ACL e grantor'],
  'D policies': ['SEGURANCA', 'políticas RLS'],
  'E schema': ['SEGURANCA', 'USAGE em schemas'],
  'F funcoes': ['SEGURANCA', 'EXECUTE / SECURITY DEFINER'],
  'G sequencias': ['SEGURANCA', 'sequências'],
  'H triggers': ['SEGURANCA', 'triggers'],
  'I desenho': ['DERIVADA', 'derivada de B (desenho do app)'],
  'J default acl': ['SEGURANCA', 'default privileges (objectos futuros)'],
  'K cadeia': ['ESTADO', 'estado da cadeia de migrações'],
};
const [fa, fb] = process.argv.slice(2);
const A = load(fa), B = load(fb);
const key = (r) => r.join('␟');
const SA = new Set(A.map(key)), SB = new Set(B.map(key));
const dupA = A.length - SA.size, dupB = B.length - SB.size;
const diffs = [...A.filter((r) => !SB.has(key(r))).map((r) => ['-', r]), ...B.filter((r) => !SA.has(key(r))).map((r) => ['+', r])];
console.log(`linhas: antiga=${A.length} nova=${B.length} | duplicadas: ${dupA}/${dupB} | diferenças reais (após normalização): ${diffs.length}`);
const bySec = {};
for (const [s, r] of diffs) { const c = CLASS[r[0]] ?? ['DESCONHECIDA', 'secção não reconhecida']; (bySec[c[0]] ??= []).push([s, r, c[1]]); }
for (const cls of ['SEGURANCA', 'ESTADO', 'DERIVADA', 'DESCONHECIDA', 'INFO']) for (const [s, r, why] of bySec[cls] ?? [])
  console.log(`  [${cls}] ${s} ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]}   (${why})`);
const blocking = (bySec.SEGURANCA?.length ?? 0) + (bySec.ESTADO?.length ?? 0) + (bySec.DERIVADA?.length ?? 0) + (bySec.DESCONHECIDA?.length ?? 0);
const verdict = diffs.length === 0 ? 'IDENTICO (sem deriva)'
  : blocking === 0 ? 'SO DIFERENCAS INFORMATIVAS (rever, nao bloqueia)'
  : 'DERIVA RELEVANTE (PARAR e reportar ao Level 2)';
console.log('VEREDICTO:', verdict);
process.exit(blocking === 0 ? 0 : 1);
