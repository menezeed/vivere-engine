// SEC-O-019: compara duas auditorias (antes/depois da 0023) e verifica que a ÚNICA mudança
// de privilégios é exactamente o conjunto concedido pela 0023. Local; não liga a nada.
// Uso: node compare-audits.mjs <antes.csv|.out> <depois.csv|.out>
import { readFileSync } from 'node:fs';
function load(f) {
  const raw = readFileSync(f, 'utf8').replace(/^﻿/, '');
  if (/^sec,objeto,papel,detalhe,estado/.test(raw)) {
    const rows = []; let row = [], x = '', q = false;
    for (let i = 0; i < raw.length; i++) { const c = raw[i];
      if (q) { if (c === '"' && raw[i + 1] === '"') { x += '"'; i++; } else if (c === '"') q = false; else x += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(x); x = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && raw[i + 1] === '\n') i++; row.push(x); rows.push(row); row = []; x = ''; } else x += c; }
    if (x || row.length) { row.push(x); rows.push(row); }
    return rows.slice(1).filter((r) => r.length === 5);
  }
  return raw.split(/\r?\n/).filter((l) => / \| /.test(l) && !/^sec \| /.test(l)).map((l) => { const p = l.split(' | '); return [p[0], p[1], p[2], p.slice(3, -1).join(' | '), p.at(-1)]; });
}
const [fa, fb] = process.argv.slice(2);
const A = load(fa), B = load(fb);
const key = (r) => r.join('␟');
const SA = new Set(A.map(key)), SB = new Set(B.map(key));
const added = B.filter((r) => !SA.has(key(r))), removed = A.filter((r) => !SB.has(key(r)));
// Entradas de ACL que a 0023 deve criar (secção L), e nada mais nas secções de privilégios
const exp0023 = [
  ['public.categories', 'anon', 'SELECT (tabela)'], ['public.categories', 'authenticated', 'SELECT (tabela)'],
  ['public.venues', 'anon', 'SELECT (tabela)'], ['public.venues', 'authenticated', 'SELECT (tabela)'],
  ['public.partners', 'anon', 'SELECT (tabela)'], ['public.partners', 'authenticated', 'SELECT (tabela)'],
  ['public.favorites', 'authenticated', 'SELECT (tabela)'], ['public.favorites', 'authenticated', 'DELETE (tabela)'],
  ...['activity_id', 'user_id'].map((c) => ['public.favorites', 'authenticated', `INSERT(${c})`]),
  ...['anon', 'authenticated'].flatMap((r) => ['comment', 'email', 'language', 'location', 'phone', 'title'].map((c) => ['public.suggestions', r, `INSERT(${c})`])),
];
const addedL = added.filter((r) => r[0] === 'L acl').map((r) => [r[1], r[2], r[3].replace(/ grantor=.*/, '')]);
const grantorsL = [...new Set(added.filter((r) => r[0] === 'L acl').map((r) => r[3].match(/grantor=(\S+)/)?.[1]))];
const k3 = (x) => x.join('|');
const missing = exp0023.filter((e) => !addedL.some((a) => k3(a) === k3(e)));
const unexpectedL = addedL.filter((a) => !exp0023.some((e) => k3(a) === k3(e)));
const removedL = removed.filter((r) => r[0] === 'L acl');
// V (versão) é informativa: mostrada, mas não falha a verificação
const infoOnly = [...added, ...removed].filter((r) => r[0] === 'V versao');
const otherSections = [...added, ...removed].filter((r) => !['L acl', 'B privs', 'C colunas', 'I desenho', 'K cadeia', 'V versao'].includes(r[0]));
for (const r of infoOnly) console.log('INFO  versão diferente entre as duas auditorias:', r[3]);
const I = B.filter((r) => r[0] === 'I desenho');
const cnt = (e) => I.filter((r) => r[4] === e).length;
const checks = [
  ['entradas de ACL novas = exactamente as 22 da 0023', missing.length === 0 && unexpectedL.length === 0 && addedL.length === 22, `novas=${addedL.length} em_falta=${missing.length} inesperadas=${unexpectedL.length}`],
  ['grantor das entradas novas = postgres', grantorsL.length === 1 && grantorsL[0] === 'postgres', grantorsL.join(',') || '-'],
  ['nenhuma entrada de ACL removida', removedL.length === 0, `removidas=${removedL.length}`],
  ['políticas, RLS, schemas, funções, triggers e default ACL inalterados', otherSections.length === 0, `diferenças=${otherSections.length}`],
  ['desenho: 0 FALTA', cnt('FALTA') === 0, `FALTA=${cnt('FALTA')}`],
  ['desenho: 7 PENDENTE (activity_interests, 0024)', cnt('PENDENTE') === 7, `PENDENTE=${cnt('PENDENTE')}`],
  ['nenhuma linha ATENCAO', !B.some((r) => r[4] === 'ATENCAO'), ''],
  ['marcador K 0023 = OK', B.some((r) => r[0] === 'K cadeia' && r[1] === '0023' && r[4] === 'OK'), ''],
];
for (const [n, ok, d] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`);
for (const m of missing) console.log('  em falta:', m.join(' '));
for (const u of unexpectedL) console.log('  inesperada:', u.join(' '));
for (const r of removedL) console.log('  removida:', r.slice(1, 4).join(' '));
for (const r of otherSections) console.log('  outra diferença:', r.join(' | '));
console.log(`TOTAL ${checks.filter((c) => c[1]).length}/${checks.length}`);
process.exit(checks.every((c) => c[1]) ? 0 : 1);
