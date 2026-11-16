// Ensaio de reconstrução a partir das migrações (P0-6) — SÓ LOCAL, DESCARTÁVEL.
//
// Levanta um PostgreSQL EM MEMÓRIA (PGlite: PostgreSQL compilado para WASM,
// corre dentro do Node), aplica a simulação do Supabase e todas as migrações
// por ordem, corre a auditoria só de leitura e, para a migração escolhida
// (por omissão 0028), faz o ciclo aplicar → testes → rollback → reaplicar,
// comparando o catálogo antes/depois. Nunca liga a nenhuma base remota: não
// lê .env, não abre sockets, não usa credenciais. Tudo desaparece no fim.
//
// Uso (na raiz do repositório):
//   node scripts/db/rebuild-drill.pglite.mjs [opções]
//     --ref <git-ref>          lê db/ desse ref com `git show` (omissão: HEAD)
//     --root <pasta>           lê db/ de uma pasta com o layout do repositório
//     --extra <ref>:<caminho>  sobrepõe um ficheiro de outro ref (repetível)
//     --roundtrip <NNNN|none>  migração do ciclo (omissão: 0028 se existir)
//     --out <pasta>            saída (omissão: runs/rebuild-drill/<data>; runs/ está no .gitignore)
//
// Exemplo (integracao + ficheiros 0028 de outra branch, sem checkout):
//   node scripts/db/rebuild-drill.pglite.mjs --ref origin/integracao/migrations-p0 \
//     --extra <sha>:db/migrations/0028_api_budget.sql \
//     --extra <sha>:db/migrations/0028_api_budget.rollback.sql \
//     --extra <sha>:db/audit/api-budget-tests.staging.sql
//
// Adaptações ao PGlite (documentadas em docs/runbooks/rebuild-drill-pglite.md):
//   A1 o superutilizador de arranque do PGlite chama-se `postgres`; é renomeado
//      para `supabase_admin` (como no Supabase), para que a simulação possa
//      criar o `postgres` NÃO superutilizador tal como está escrita;
//   A2 `:"dbname"` (variável do psql) da simulação é substituído pelo nome da
//      base do PGlite ("postgres");
//   A3 o `psql -U postgres` é feito com SET SESSION AUTHORIZATION postgres;
//   A4 cada ficheiro é enviado numa única mensagem (protocolo simples), como
//      no SQL Editor — não instrução a instrução como o psql;
//   A5 pg_trgm é carregado como extensão contrib do PGlite (0007).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  migrations: 'db/migrations',
  sim: 'db/audit/local/supabase-sim.sql',
  audit: 'db/audit/grants-audit.readonly.sql',
};

// Testes por migração do ciclo. `confirm` só é substituído na cópia em memória.
export const DEFAULT_TESTS = {
  '0028': {
    path: 'db/audit/api-budget-tests.staging.sql',
    confirm: { from: /v_confirm\s+text\s*:=\s*'NAO_CONFIRMADO'/, to: "v_confirm text := 'staging'" },
    report: /RELATORIO\s+(\S+)[^:]*:\s*(\d+)\s+FAIL\s+de\s+(\d+)/,
  },
};

const MIG_RX = /^(\d{4})_[a-z0-9_]+\.sql$/;

export function sha256Lf(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

// ---------------------------------------------------------------- fontes
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Fonte de ficheiros: um ref git ou uma pasta, mais sobreposições ref:caminho. */
export function makeSource({ ref, root, extras = [], cwd = REPO_ROOT }) {
  const overlay = new Map();
  for (const e of extras) {
    const i = e.indexOf(':');
    if (i <= 0) throw new Error(`--extra inválido (esperado <ref>:<caminho>): ${e}`);
    const p = e.slice(i + 1).replace(/\\/g, '/');
    overlay.set(p, { ref: e.slice(0, i), text: git(['show', e], cwd) });
  }
  const label = root ? `pasta ${root}` : `ref ${ref || 'HEAD'}`;
  const read = (p) => {
    if (overlay.has(p)) return overlay.get(p).text;
    if (root) {
      const f = join(root, p);
      return existsSync(f) ? readFileSync(f, 'utf8') : null;
    }
    try { return git(['show', `${ref || 'HEAD'}:${p}`], cwd); } catch { return null; }
  };
  const list = (dir) => {
    let names;
    if (root) names = existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : [];
    else names = git(['ls-tree', '--name-only', `${ref || 'HEAD'}:${dir}`], cwd).split('\n').filter(Boolean);
    for (const p of overlay.keys()) if (dirname(p) === dir) names.push(p.slice(dir.length + 1));
    return [...new Set(names)].sort();
  };
  return { label, read, list, overlay };
}

// ---------------------------------------------------------------- catálogo
// Instantâneo do catálogo: uma linha por facto, ordenado (comparável com diff).
// Cobre todos os schemas não-sistema (public, staging, auth, ...).
export const CATALOG_SNAPSHOT_SQL = `
with ns as (
  select oid, nspname from pg_catalog.pg_namespace
  where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    and nspname not like 'pg_temp_%' and nspname not like 'pg_toast_temp_%'
),
g(oid, name) as (select 0::oid, 'PUBLIC' union all select oid, rolname::text from pg_catalog.pg_roles),
facts(line) as (
  select 'ns|' || n.nspname || '|owner=' || pg_catalog.pg_get_userbyid(x.nspowner) || '|acl=' || coalesce(x.nspacl::text, '-')
  from ns n join pg_catalog.pg_namespace x on x.oid = n.oid
  union all
  select 'ext|' || e.extname || '|' || e.extversion || '|' || e.extnamespace::regnamespace::text from pg_catalog.pg_extension e
  union all
  select 'role|' || r.rolname || '|super=' || r.rolsuper || '|inherit=' || r.rolinherit || '|createrole=' || r.rolcreaterole
         || '|createdb=' || r.rolcreatedb || '|login=' || r.rolcanlogin || '|bypassrls=' || r.rolbypassrls
  from pg_catalog.pg_roles r where r.rolname !~ '^pg_'
  union all
  select 'member|' || pg_catalog.pg_get_userbyid(m.roleid) || '|' || pg_catalog.pg_get_userbyid(m.member) || '|admin=' || m.admin_option
  from pg_catalog.pg_auth_members m where pg_catalog.pg_get_userbyid(m.roleid) !~ '^pg_'
  union all
  select 'rel|' || n.nspname || '.' || c.relname || '|' || c.relkind::text || '|owner=' || pg_catalog.pg_get_userbyid(c.relowner)
         || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity || '|opts=' || coalesce(c.reloptions::text, '-')
  from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace
  where c.relkind in ('r', 'v', 'm', 'S', 'p', 'f', 'c')
  union all
  select 'col|' || n.nspname || '.' || c.relname || '.' || a.attname || '|' || pg_catalog.format_type(a.atttypid, a.atttypmod)
         || '|notnull=' || a.attnotnull || '|default=' || coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '-')
         || '|identity=' || a.attidentity::text || '|generated=' || a.attgenerated::text
  from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where c.relkind in ('r', 'v', 'm', 'p', 'f', 'c')
  union all
  select 'con|' || n.nspname || '.' || coalesce(c.relname, '-') || '|' || k.conname || '|' || k.contype::text
         || '|' || pg_catalog.pg_get_constraintdef(k.oid)
  from pg_catalog.pg_constraint k join ns n on n.oid = k.connamespace
  left join pg_catalog.pg_class c on c.oid = k.conrelid
  union all
  select 'idx|' || n.nspname || '.' || i.relname || '|' || pg_catalog.pg_get_indexdef(i.oid)
  from pg_catalog.pg_class i join ns n on n.oid = i.relnamespace where i.relkind in ('i', 'I')
  union all
  select 'seq|' || s.schemaname || '.' || s.sequencename || '|' || s.data_type::text || '|start=' || s.start_value
         || '|inc=' || s.increment_by || '|owner=' || s.sequenceowner
  from pg_catalog.pg_sequences s where s.schemaname in (select nspname from ns)
  union all
  select 'type|' || n.nspname || '.' || t.typname || '|' || t.typtype::text || '|'
         || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_catalog.pg_enum e where e.enumtypid = t.oid), '-')
  from pg_catalog.pg_type t join ns n on n.oid = t.typnamespace where t.typtype in ('e', 'd')
  union all
  select 'relacl|' || n.nspname || '.' || c.relname || '|' || ge.name || '|' || a.privilege_type
         || '|grantor=' || gr.name || '|grantable=' || a.is_grantable
  from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault(
      (case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
  join g ge on ge.oid = a.grantee join g gr on gr.oid = a.grantor
  where c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
  union all
  select 'colacl|' || n.nspname || '.' || c.relname || '.' || att.attname || '|' || ge.name || '|'
         || a.privilege_type || '|grantor=' || gr.name || '|grantable=' || a.is_grantable
  from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
  cross join lateral pg_catalog.aclexplode(att.attacl) a
  join g ge on ge.oid = a.grantee join g gr on gr.oid = a.grantor
  union all
  select 'fn|' || n.nspname || '.' || f.proname || '(' || pg_catalog.pg_get_function_identity_arguments(f.oid) || ')' || '|owner=' || pg_catalog.pg_get_userbyid(f.proowner)
         || '|secdef=' || f.prosecdef || '|config=' || coalesce(f.proconfig::text, '-')
         || '|vol=' || f.provolatile::text || '|lang=' || l.lanname || '|ret=' || pg_catalog.pg_get_function_result(f.oid)
         || '|src=' || pg_catalog.md5(coalesce(f.prosrc, ''))
  from pg_catalog.pg_proc f join ns n on n.oid = f.pronamespace join pg_catalog.pg_language l on l.oid = f.prolang
  union all
  select 'fnacl|' || n.nspname || '.' || f.proname || '(' || pg_catalog.pg_get_function_identity_arguments(f.oid) || ')' || '|' || ge.name || '|' || a.privilege_type
         || '|grantor=' || gr.name || '|explicit=' || (f.proacl is not null)
  from pg_catalog.pg_proc f join ns n on n.oid = f.pronamespace
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f'::"char", f.proowner))) a
  join g ge on ge.oid = a.grantee join g gr on gr.oid = a.grantor
  union all
  select 'policy|' || p.schemaname || '.' || p.tablename || '|' || p.policyname || '|' || p.permissive
         || '|' || p.cmd || '|' || p.roles::text || '|' || coalesce(p.qual, '-') || '|' || coalesce(p.with_check, '-')
  from pg_catalog.pg_policies p where p.schemaname in (select nspname from ns)
  union all
  select 'trigger|' || n.nspname || '.' || c.relname || '|' || t.tgname || '|' || t.tgenabled::text
         || '|' || pg_catalog.pg_get_triggerdef(t.oid)
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
  join ns n on n.oid = c.relnamespace where not t.tgisinternal
  union all
  select 'comment|' || coalesce(pg_catalog.pg_describe_object(d.classoid, d.objoid, d.objsubid), '?') || '|' || pg_catalog.md5(d.description)
  from pg_catalog.pg_description d
  where (d.classoid = 'pg_catalog.pg_class'::pg_catalog.regclass
         and d.objoid in (select c.oid from pg_catalog.pg_class c join ns n on n.oid = c.relnamespace))
     or (d.classoid = 'pg_catalog.pg_proc'::pg_catalog.regclass
         and d.objoid in (select f.oid from pg_catalog.pg_proc f join ns n on n.oid = f.pronamespace))
     or (d.classoid = 'pg_catalog.pg_namespace'::pg_catalog.regclass and d.objoid in (select oid from ns))
     or d.classoid in ('pg_catalog.pg_policy'::pg_catalog.regclass, 'pg_catalog.pg_trigger'::pg_catalog.regclass)
  union all
  select 'defacl|' || pg_catalog.pg_get_userbyid(da.defaclrole) || '|' || coalesce(n.nspname, '*') || '|'
         || da.defaclobjtype::text || '|' || ge.name || '|' || a.privilege_type
  from pg_catalog.pg_default_acl da
  left join pg_catalog.pg_namespace n on n.oid = da.defaclnamespace
  cross join lateral pg_catalog.aclexplode(da.defaclacl) a
  join g ge on ge.oid = a.grantee
)
select line from facts order by line`;

export function diffLines(a, b) {
  const sa = new Set(a), sb = new Set(b);
  return { removed: a.filter((x) => !sb.has(x)), added: b.filter((x) => !sa.has(x)) };
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(fields, rows) {
  return [fields.map(csvCell).join(','), ...rows.map((r) => fields.map((f) => csvCell(r[f])).join(','))].join('\n') + '\n';
}

function errText(e) {
  const parts = [e.message];
  if (e.code) parts.push(`SQLSTATE ${e.code}`);
  if (e.detail) parts.push(`DETAIL: ${e.detail}`);
  if (e.hint) parts.push(`HINT: ${e.hint}`);
  if (e.where) parts.push(`WHERE: ${e.where}`);
  return parts.join(' | ');
}

// ---------------------------------------------------------------- base PGlite
async function openDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const db = await PGlite.create({ extensions: { pg_trgm } }); // A5
  // A1: o superutilizador de arranque (oid 10) passa a chamar-se supabase_admin.
  await db.exec(`create role vivere_drill_boot superuser;
    set session authorization vivere_drill_boot;
    alter role postgres rename to supabase_admin;
    set session authorization supabase_admin;
    drop role vivere_drill_boot;`);
  return db;
}

/** Corre um ficheiro inteiro como `role` (A3/A4). Devolve null ou o erro. */
async function runAs(db, role, sql) {
  try {
    await db.exec(`set session authorization ${role}`);
    await db.exec(sql);
    return null;
  } catch (e) {
    return e;
  } finally {
    try { await db.exec('rollback'); } catch { /* sem transacção aberta */ }
    await db.exec('set session authorization supabase_admin');
  }
}

async function snapshot(db) {
  const r = await db.query(CATALOG_SNAPSHOT_SQL);
  return r.rows.map((x) => x.line);
}

async function audit(db, sql) {
  await db.exec('set session authorization postgres');
  try {
    const r = await db.query(sql);
    return { fields: r.fields.map((f) => f.name), rows: r.rows };
  } finally {
    await db.exec('set session authorization supabase_admin');
  }
}

// ---------------------------------------------------------------- ensaio
export async function runDrill(opts = {}) {
  const log = opts.log ?? ((s) => console.log(s));
  const src = opts.source ?? makeSource(opts);
  const tests = opts.tests ?? DEFAULT_TESTS;
  const outDir = opts.out ?? join(REPO_ROOT, 'runs', 'rebuild-drill', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(outDir, { recursive: true });
  const put = (name, text) => { writeFileSync(join(outDir, name), text); return join(outDir, name); };

  const summary = {
    fonte: src.label, sobreposicoes: [...src.overlay.keys()], saida: outDir,
    adaptacoes: [], migracoes: [], aplicadas: 0, total: 0, erro: null,
    ciclo: null, auditoria: null, sha256: {}, ok: false,
  };

  const simText = src.read(PATHS.sim);
  const auditSql = src.read(PATHS.audit);
  if (simText === null) throw new Error(`${PATHS.sim} não existe em ${src.label}`);
  if (auditSql === null) throw new Error(`${PATHS.audit} não existe em ${src.label}`);

  const files = src.list(PATHS.migrations).filter((f) => MIG_RX.test(f)); // ignora *.rollback.sql
  summary.total = files.length;
  const num = (f) => f.slice(0, 4);
  let rt = opts.roundtrip;
  if (rt === undefined) rt = files.some((f) => num(f) === '0028') ? '0028' : 'none';
  const rtFile = rt === 'none' ? null : files.find((f) => num(f) === rt);
  if (rt !== 'none' && !rtFile) throw new Error(`--roundtrip ${rt}: migração não encontrada`);

  const db = await openDb();
  try {
    const ver = (await db.query('select current_setting(\'server_version\') v')).rows[0].v;
    summary.versao = ver;
    summary.adaptacoes.push('A1 superutilizador de arranque do PGlite renomeado postgres → supabase_admin');

    // A2: variável do psql
    const nDb = (simText.match(/:"dbname"/g) || []).length;
    const sim = simText.replace(/:"dbname"/g, '"postgres"');
    summary.adaptacoes.push(`A2 supabase-sim.sql: ${nDb} ocorrência(s) de :"dbname" → "postgres" (só em memória)`);
    summary.adaptacoes.push('A3 psql -U postgres → SET SESSION AUTHORIZATION postgres');
    summary.adaptacoes.push('A4 cada ficheiro numa única mensagem (protocolo simples), não instrução a instrução');
    summary.adaptacoes.push('A5 pg_trgm carregado como extensão contrib do PGlite');
    const simErr = await runAs(db, 'supabase_admin', sim);
    if (simErr) throw new Error(`supabase-sim.sql falhou: ${errText(simErr)}`);
    log(`sim  | supabase-sim.sql aplicada (PostgreSQL ${ver})`);

    const apply = async (f) => {
      const text = src.read(`${PATHS.migrations}/${f}`);
      const e = await runAs(db, 'postgres', text);
      return e;
    };

    for (const f of files) {
      if (rtFile && f === rtFile) {
        summary.ciclo = await roundTrip(db, src, f, tests[num(f)], auditSql, put, log, summary);
        if (summary.ciclo.erro) { summary.erro = { ficheiro: f, mensagem: summary.ciclo.erro }; break; }
        summary.aplicadas++; summary.migracoes.push(f);
        continue;
      }
      const e = await apply(f);
      if (e) { summary.erro = { ficheiro: f, mensagem: errText(e) }; log(`FALHA| ${f}: ${errText(e)}`); break; }
      summary.aplicadas++; summary.migracoes.push(f);
      log(`ok   | ${f}`);
    }

    if (!summary.erro) {
      const a = await audit(db, auditSql);
      const p = put('grants-audit-final.csv', toCsv(a.fields, a.rows));
      const estados = {};
      for (const r of a.rows) estados[r.estado] = (estados[r.estado] || 0) + 1;
      summary.auditoria = { ficheiro: p, linhas: a.rows.length, estados };
      put('catalog-final.snap', (await snapshot(db)).join('\n') + '\n');
    }
  } finally {
    await db.close();
  }

  const c = summary.ciclo;
  summary.ok = !summary.erro && (!c || (c.rollbackIgual && c.reaplicacaoIgual && c.testes?.estado !== 'FALHA' && c.residuoTestes !== false));
  put('summary.json', JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

async function roundTrip(db, src, f, test, auditSql, put, log, summary) {
  const n = f.slice(0, 4);
  const rbName = f.replace(/\.sql$/, '.rollback.sql');
  const fwd = src.read(`${PATHS.migrations}/${f}`);
  const rb = src.read(`${PATHS.migrations}/${rbName}`);
  const out = { migracao: f, rollback: rbName, erro: null, testes: null };
  summary.sha256[f] = sha256Lf(fwd);
  if (rb !== null) summary.sha256[rbName] = sha256Lf(rb);

  const auditCsv = async (tag) => { const a = await audit(db, auditSql); put(`grants-audit-${tag}.csv`, toCsv(a.fields, a.rows)); return toCsv(a.fields, a.rows); };
  const snap = async (tag) => { const s = await snapshot(db); put(`catalog-${tag}.snap`, s.join('\n') + '\n'); return s; };

  const preSnap = await snap(`pre-${n}`);
  const preAudit = await auditCsv(`pre-${n}`);

  let e = await runAs(db, 'postgres', fwd);
  if (e) { out.erro = errText(e); log(`FALHA| ${f}: ${out.erro}`); return out; }
  log(`ok   | ${f} (ciclo)`);
  const postSnap = await snap(`post-${n}`);
  const postAudit = await auditCsv(`post-${n}`);
  out.factosAlterados = diffLines(preSnap, postSnap);

  // Testes da migração (cópia em memória, guarda de ambiente confirmada só aqui).
  if (test) {
    const raw = src.read(test.path);
    if (raw === null) out.testes = { estado: 'AUSENTE', ficheiro: test.path };
    else {
      const hits = (raw.match(new RegExp(test.confirm.from.source, 'g')) || []).length;
      if (hits !== 1) out.testes = { estado: 'FALHA', motivo: `guarda v_confirm encontrada ${hits} vez(es) (esperado 1)` };
      else {
        const te = await runAs(db, 'postgres', raw.replace(test.confirm.from, test.confirm.to));
        const m = te && te.message.match(test.report);
        if (!m) out.testes = { estado: 'FALHA', motivo: te ? `erro inesperado: ${errText(te)}` : 'terminou sem RAISE do relatório' };
        else {
          const linhas = te.message.split('\n').slice(1).filter(Boolean);
          out.testes = { estado: m[2] === '0' ? 'OK' : 'FALHA', fail: Number(m[2]), total: Number(m[3]), linhas };
          put(`tests-${n}.txt`, te.message + '\n');
        }
      }
      log(`test | ${test.path}: ${out.testes.estado}${out.testes.total !== undefined ? ` (${out.testes.fail} FAIL de ${out.testes.total})` : ` — ${out.testes.motivo}`}`);
      const afterTests = await snapshot(db);
      const d = diffLines(postSnap, afterTests);
      out.residuoTestes = d.added.length === 0 && d.removed.length === 0;
    }
  }

  // Reaplicação directa (informativo: as migrações não idempotentes abortam).
  e = await runAs(db, 'postgres', fwd);
  const afterReapply = await snapshot(db);
  const dr = diffLines(postSnap, afterReapply);
  out.reaplicacaoDirecta = { abortou: !!e, mensagem: e ? e.message : null, catalogoInalterado: !dr.added.length && !dr.removed.length };
  log(`info | reaplicar ${f} sobre si própria: ${e ? `abortou (${e.message.split('\n')[0]})` : 'aplicou'}; catálogo ${out.reaplicacaoDirecta.catalogoInalterado ? 'inalterado' : 'ALTERADO'}`);

  // Rollback → tem de voltar exactamente ao estado anterior.
  if (rb === null) { out.erro = `${rbName} não existe`; return out; }
  e = await runAs(db, 'postgres', rb);
  if (e) { out.erro = `rollback falhou: ${errText(e)}`; log(`FALHA| ${rbName}: ${out.erro}`); return out; }
  const rbSnap = await snap(`rollback-${n}`);
  const rbAudit = await auditCsv(`rollback-${n}`);
  const d1 = diffLines(preSnap, rbSnap);
  out.rollbackIgual = !d1.added.length && !d1.removed.length && rbAudit === preAudit;
  out.rollbackDiff = d1;
  out.factosComparados = preSnap.length;
  log(`ok   | ${rbName}: catálogo ${out.rollbackIgual ? 'IGUAL' : 'DIFERENTE'} ao pré-${n} (${preSnap.length} factos; auditoria ${rbAudit === preAudit ? 'igual' : 'diferente'})`);

  // Reaplicar → tem de voltar exactamente ao estado pós-migração.
  e = await runAs(db, 'postgres', fwd);
  if (e) { out.erro = `reaplicação falhou: ${errText(e)}`; log(`FALHA| ${f} (reaplicação): ${out.erro}`); return out; }
  const againSnap = await snap(`reapply-${n}`);
  const againAudit = await auditCsv(`reapply-${n}`);
  const d2 = diffLines(postSnap, againSnap);
  out.reaplicacaoIgual = !d2.added.length && !d2.removed.length && againAudit === postAudit;
  out.reaplicacaoDiff = d2;
  log(`ok   | ${f} reaplicada: catálogo ${out.reaplicacaoIgual ? 'IGUAL' : 'DIFERENTE'} ao pós-${n}`);
  return out;
}

export function formatSummary(s) {
  const c = s.ciclo;
  const L = [];
  L.push(`== RESUMO DO ENSAIO DE RECONSTRUÇÃO (PGlite, PostgreSQL ${s.versao ?? '?'})`);
  L.push(`Fonte: ${s.fonte}${s.sobreposicoes.length ? ` + ${s.sobreposicoes.length} ficheiro(s) sobreposto(s)` : ''}`);
  L.push(`Migrações aplicadas: ${s.aplicadas}/${s.total}${s.migracoes.length ? ` (${s.migracoes[0].slice(0, 4)} → ${s.migracoes.at(-1).slice(0, 4)})` : ''}`);
  if (s.erro) L.push(`PAROU em ${s.erro.ficheiro}: ${s.erro.mensagem}`);
  if (c) {
    const n = c.migracao.slice(0, 4);
    for (const [k, v] of Object.entries(s.sha256)) L.push(`SHA-256 (LF) ${k}: ${v}`);
    if (c.factosAlterados) L.push(`${n} altera ${c.factosAlterados.added.length + c.factosAlterados.removed.length} factos do catálogo (+${c.factosAlterados.added.length} / -${c.factosAlterados.removed.length})`);
    if (c.testes) L.push(`Testes ${n}: ${c.testes.estado}${c.testes.total !== undefined ? ` (${c.testes.fail} FAIL de ${c.testes.total})` : ` — ${c.testes.motivo ?? c.testes.ficheiro}`}${c.residuoTestes === undefined ? '' : `; resíduo no catálogo: ${c.residuoTestes ? 'nenhum' : 'SIM'}`}`);
    if (c.reaplicacaoDirecta) L.push(`Reaplicar ${n} sobre si própria: ${c.reaplicacaoDirecta.abortou ? 'aborta' : 'aplica'} (catálogo ${c.reaplicacaoDirecta.catalogoInalterado ? 'inalterado' : 'ALTERADO'})`);
    if (c.rollbackIgual !== undefined) L.push(`Rollback ${n}: ${c.rollbackIgual ? 'IGUAL' : 'DIFERENTE'} ao estado pré-${n} (${c.factosComparados} factos + auditoria)`);
    if (c.rollbackIgual === false) for (const x of [...c.rollbackDiff.removed.map((l) => `  - ${l}`), ...c.rollbackDiff.added.map((l) => `  + ${l}`)].slice(0, 30)) L.push(x);
    if (c.reaplicacaoIgual !== undefined) L.push(`Reaplicação ${n} após rollback: ${c.reaplicacaoIgual ? 'IGUAL' : 'DIFERENTE'} ao estado pós-${n}`);
  }
  if (s.auditoria) L.push(`Auditoria final: ${s.auditoria.linhas} linhas (${Object.entries(s.auditoria.estados).map(([k, v]) => `${k}=${v}`).join(', ')})`);
  L.push(`Saída: ${s.saida}`);
  L.push(`RESULTADO: ${s.ok ? 'OK' : 'FALHA'}`);
  return L.join('\n');
}

function parseArgs(argv) {
  const o = { extras: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) throw new Error(`${a} precisa de valor`); return argv[++i]; };
    if (a === '--ref') o.ref = v();
    else if (a === '--root') o.root = resolve(v());
    else if (a === '--extra') o.extras.push(v());
    else if (a === '--roundtrip') o.roundtrip = v();
    else if (a === '--out') o.out = resolve(v());
    else throw new Error(`opção desconhecida: ${a}`);
  }
  if (o.ref && o.root) throw new Error('--ref e --root são exclusivos');
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  runDrill(opts).then((s) => {
    console.log('\n' + formatSummary(s));
    process.exit(s.ok ? 0 : 1);
  }, (e) => { console.error(`ERRO: ${e.message}`); process.exit(2); });
}
