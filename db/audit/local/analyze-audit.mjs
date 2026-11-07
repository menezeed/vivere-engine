// SEC-O-017: análise LOCAL do CSV da auditoria (grants-audit.readonly.sql).
// Não liga a nada. Uso: node analyze-audit.mjs <ficheiro.csv|.out>
// Aceita o CSV exportado pelo SQL Editor / psql --csv (cabeçalho sec,objeto,papel,detalhe,estado)
// ou a saída local "a | b | c | d | e" (só para testes do analisador).
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const raw = readFileSync(file, 'utf8').replace(/^﻿/, '');

// ---------- 0. Controlo de sanitização (antes de tudo) ----------
const leaks = {
  'e-mail': /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  'JWT': /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g,
  'chave sb_': /sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/g,
  'chave Google': /AIza[0-9A-Za-z_-]{35}/g,
  'connection string': /postgres(ql)?:\/\/[^\s"]+/g,
  'UUID': /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
};
const found = Object.entries(leaks).map(([k, rx]) => [k, (raw.match(rx) || []).length]).filter(([, n]) => n);
console.log('## 0. Sanitização:', found.length ? 'ATENÇÃO ' + found.map(([k, n]) => `${k}=${n}`).join(' ') : 'sem e-mails, JWT, chaves, connection strings nem UUID');
if (found.some(([k]) => k !== 'UUID')) { console.log('PARAR: o ficheiro contém dados sensíveis; não partilhar.'); process.exit(2); }

// ---------- parsing ----------
function parseCsv(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}
let rows;
if (/^sec,objeto,papel,detalhe,estado/m.test(raw.split('\n')[0])) rows = parseCsv(raw).slice(1);
else rows = raw.split(/\r?\n/).filter((l) => / \| /.test(l) && !/^sec \| /.test(l)).map((l) => {
  const p = l.split(' | '); return [p[0], p[1], p[2], p.slice(3, -1).join(' | '), p.at(-1)];
});
const R = rows.map(([sec, objeto, papel, detalhe, estado]) => ({ sec, objeto, papel, detalhe, estado }));
const by = (s) => R.filter((r) => r.sec.startsWith(s));
console.log(`linhas: ${R.length}`);

// ---------- 3. Versão ----------
console.log('\n## 3. Versão:', by('V')[0]?.detalhe ?? 'n/d');

// ---------- estado da cadeia ----------
console.log('\n## Cadeia de migrações (K)');
for (const r of by('K')) console.log(`  ${r.objeto} ${r.detalhe.padEnd(45)} ${r.estado}`);

// ---------- A: RLS, vistas ----------
console.log('\n## RLS e vistas (A)');
for (const r of by('A')) {
  const flag = r.estado === 'ATENCAO' ? '  <== ATENCAO' : '';
  if (/kind=v/.test(r.detalhe) || flag || /favorites|interests|suggestions|categories|venues|partners|activities/.test(r.objeto))
    console.log(`  ${r.objeto.padEnd(28)} ${r.detalhe}${flag}`);
}

// ---------- 4. Matriz ----------
console.log('\n## 4. Privilégios efectivos (B) — anon / authenticated');
const app = ['public.activities', 'public.active_activities', 'public.categories', 'public.venues', 'public.partners',
  'public.favorites', 'public.activity_interests', 'public.suggestions', 'public.users',
  'public.products', 'public.sources', 'public.publication_runs', 'public.publication_events'];
for (const t of app) for (const rol of ['anon', 'authenticated', 'service_role']) {
  const r = by('B').find((x) => x.objeto === t && x.papel === rol); if (r) console.log(`  ${t.padEnd(28)} ${rol.padEnd(14)} ${r.detalhe}`);
}
console.log('\n## Privilégios só de coluna (C)');
for (const r of by('C')) console.log(`  ${r.objeto.padEnd(28)} ${r.papel.padEnd(14)} ${r.detalhe}`);
console.log('\n## Entradas de ACL com grantor (L) — só SELECT/INSERT/UPDATE/DELETE de anon/authenticated/PUBLIC');
const L = by('L').filter((r) => ['anon', 'authenticated', 'PUBLIC'].includes(r.papel) && /^(SELECT|INSERT|UPDATE|DELETE)/.test(r.detalhe));
if (!L.length) console.log('  (nenhuma)'); for (const r of L) console.log(`  ${r.objeto.padEnd(28)} ${r.papel.padEnd(14)} ${r.detalhe}`);
const grantors = [...new Set(by('L').map((r) => r.detalhe.match(/grantor=(\S+)/)?.[1]).filter(Boolean))];
console.log('  grantors presentes:', grantors.join(', ') || 'n/d');

// ---------- 5. P2: privilégios que fariam a 0023 abortar ----------
console.log('\n## 5. Simulação da P2 da 0023 (privilégios-alvo já existentes)');
const target = [['categories', 'anon', 'SEL'], ['categories', 'authenticated', 'SEL'], ['venues', 'anon', 'SEL'], ['venues', 'authenticated', 'SEL'],
  ['partners', 'anon', 'SEL'], ['partners', 'authenticated', 'SEL'], ['favorites', 'authenticated', 'SEL'], ['favorites', 'authenticated', 'DEL'],
  ['favorites', 'authenticated', 'INS'], ['suggestions', 'anon', 'INS'], ['suggestions', 'authenticated', 'INS']];
const p2 = target.filter(([t, rol, p]) => { const r = by('B').find((x) => x.objeto === 'public.' + t && x.papel === rol);
  const v = r?.detalhe.match(new RegExp(p + '=(\\S)'))?.[1]; return v && v !== '-'; });
console.log(p2.length ? '  A 0023 ABORTARIA (P2): ' + p2.map(([t, r, p]) => `${r} ${p} ${t}`).join('; ') : '  nenhum: a P2 passaria');

// ---------- 6. Políticas ----------
const expected = {
  categories: [['Qualquer um pode ver categorias', 'SELECT', 'public', 'true', '-'], ['admin_role_all', 'ALL', 'authenticated', 'ADMIN', 'ADMIN']],
  venues: [['Leitura pública de venues', 'SELECT', 'public', 'true', '-'], ['admin_role_all', 'ALL', 'authenticated', 'ADMIN', 'ADMIN']],
  partners: [['Leitura pública de parceiros', 'SELECT', 'public', 'true', '-'], ['admin_role_all', 'ALL', 'authenticated', 'ADMIN', 'ADMIN']],
  favorites: [['Favoritos do usuário', 'ALL', 'public', '(auth.uid() = user_id)', '-']],
  suggestions: [['Publico pode enviar sugestao pendente', 'INSERT', 'public', '-', "((status = 'pending'::text) AND (length(TRIM(BOTH FROM title)) > 0))"]],
};
const ADMIN = "(((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)";
console.log('\n## 6. Políticas RLS (D)');
const pols = by('D').map((r) => { const [name, cmd, perm, using, check] = r.detalhe.split(' | ');
  return { t: r.objeto.replace('public.', ''), roles: r.papel, name, cmd, perm, using: using?.replace(/^using=/, ''), check: check?.replace(/^check=/, '') }; });
for (const p of pols) console.log(`  ${p.t.padEnd(19)} ${p.name.padEnd(40)} ${p.cmd.padEnd(6)} ${p.perm.padEnd(11)} roles=${p.roles.padEnd(20)} using=${p.using} check=${p.check}`);
console.log('\n## Simulação da P1 da 0023 (5 tabelas, comparação exacta)');
let p1 = [];
for (const [t, exp] of Object.entries(expected)) {
  const act = pols.filter((p) => p.t === t);
  const key = (n, c, r, u, k) => [n, c, 'PERMISSIVE', r, u === 'ADMIN' ? ADMIN : u, k === 'ADMIN' ? ADMIN : k].join('§');
  const E = new Set(exp.map((e) => key(...e))); const A = new Set(act.map((p) => [p.name, p.cmd, p.perm, p.roles.split(',').sort().join(','), p.using, p.check].join('§')));
  for (const e of E) if (!A.has(e)) p1.push(`${t}: esperada ausente/diferente -> ${e.split('§').slice(0, 2).join(' ')}`);
  for (const a of A) if (!E.has(a)) p1.push(`${t}: inesperada -> ${a.split('§').slice(0, 2).join(' ')}`);
}
console.log(p1.length ? '  A 0023 ABORTARIA (P1):\n    ' + p1.join('\n    ') : '  conjunto exacto: a P1 passaria');
console.log('\n## Políticas permissivas a rever (escrita com USING/CHECK true, ou fora da 0020)');
const known0020 = new Set(['Leitura pública de atividades', 'admin_role_all', 'compat_interested_count_update', 'Leitura pública de venues',
  'Qualquer um pode ver categorias', 'Leitura pública de parceiros', 'Favoritos do usuário', 'Inserir interesse identificado',
  'Qualquer um pode ver interesses', 'Só o próprio pode apagar', 'Publico pode enviar sugestao pendente']);
const risky = pols.filter((p) => !known0020.has(p.name) || (p.cmd !== 'SELECT' && (p.using === 'true' || p.check === 'true')));
for (const p of risky) console.log(`  ${known0020.has(p.name) ? '(0020, conhecida)' : 'FORA DA 0020     '} ${p.t}.${p.name} ${p.cmd} roles=${p.roles} using=${p.using} check=${p.check}`);
if (!risky.length) console.log('  nenhuma');

// ---------- desenho, schema, funções, default ACL ----------
console.log('\n## Diferenças face ao desenho (I)');
for (const est of ['FALTA', 'PENDENTE']) { const x = by('I').filter((r) => r.estado === est); console.log(`  ${est}: ${x.length}`); x.forEach((r) => console.log(`    ${r.objeto} ${r.papel} ${r.detalhe}`)); }
const extra = by('I').filter((r) => r.estado === 'EXTRA');
const extraRW = extra.filter((r) => /^(SELECT|INSERT|UPDATE|DELETE)/.test(r.detalhe));
console.log(`  EXTRA: ${extra.length} (dos quais SELECT/INSERT/UPDATE/DELETE: ${extraRW.length})`);
extraRW.forEach((r) => console.log(`    ${r.objeto} ${r.papel} ${r.detalhe}`));
console.log('\n## Schemas (E) e funções (F)');
for (const r of by('E')) if (r.papel !== 'service_role') console.log(`  ${r.objeto.padEnd(8)} ${r.papel.padEnd(14)} ${r.detalhe} ${r.estado}`);
for (const r of by('F')) console.log(`  ${r.objeto.padEnd(52)} ${r.papel.padEnd(14)} ${r.detalhe} ${r.estado}`);
console.log('\n## Default ACL (J)');
for (const r of by('J')) console.log(`  ${r.objeto} ${r.papel}: ${r.detalhe}`);
console.log('\n## Triggers (H)'); for (const r of by('H')) console.log(`  ${r.objeto} ${r.detalhe}`);
console.log('\n## Sequências (G):', by('G').length ? by('G').map((r) => r.objeto + ' ' + r.papel + ' ' + r.detalhe).join('; ') : 'nenhuma');
const atencao = R.filter((r) => r.estado === 'ATENCAO');
console.log('\n## Linhas ATENCAO:', atencao.length ? '' : 'nenhuma'); atencao.forEach((r) => console.log(`  ${r.sec} ${r.objeto} ${r.papel} ${r.detalhe}`));
