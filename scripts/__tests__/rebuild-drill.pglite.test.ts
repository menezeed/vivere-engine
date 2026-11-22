import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
// @ts-expect-error — módulo .mjs sem tipos
import { runDrill, diffLines, toCsv } from '../db/rebuild-drill.pglite.mjs';

// Fixtures sintéticas (não usam as migrações reais): verificam o mecanismo
// do ensaio — ordem, *.rollback.sql ignorados no avanço, ciclo de rollback,
// leitura do relatório dos testes e paragem no primeiro erro.
const dirs: string[] = [];
function repo(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'drill-'));
  dirs.push(d);
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(d, p)), { recursive: true });
    writeFileSync(join(d, p), c);
  }
  return d;
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const base = {
  'db/audit/local/supabase-sim.sql': `
    alter database :"dbname" set vivere.sim = 'local';
    create role postgres login bypassrls;
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant create on database :"dbname" to postgres;
    alter schema public owner to postgres;`,
  'db/audit/grants-audit.readonly.sql': `
    select 'B privs'::text as sec, 'public.' || c.relname::text as objeto, 'anon'::text as papel,
           'SEL=' || pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')::text as detalhe, 'INFO'::text as estado
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by 2`,
  'db/migrations/0000_a.sql': 'create table public.t (id int primary key);',
  'db/migrations/0000_a.rollback.sql': 'select pg_catalog.pg_sleep(0); drop table public.t; -- nunca corre no avanço',
  'db/migrations/0001_b.sql': `begin;
    create table public.u (id int primary key, t_id int references public.t(id));
    grant select on public.u to anon;
    create function public.f() returns int language sql as 'select 1';
    commit;`,
  'db/migrations/0001_b.rollback.sql': 'begin; drop function public.f(); drop table public.u; commit;',
  'db/audit/t-0001.sql': `begin; do $$ declare v_confirm text := 'NAO_CONFIRMADO'; begin
      if v_confirm <> 'staging' then raise exception 'Abortado'; end if;
      insert into public.u values (1, null);
      raise exception E'RELATORIO 0001 (rollback garantido): 0 FAIL de 1\\nX1 | postgres | 1 | 1 | PASS';
    end $$; rollback;`,
};
const tests = {
  '0001': {
    path: 'db/audit/t-0001.sql',
    confirm: { from: /v_confirm\s+text\s*:=\s*'NAO_CONFIRMADO'/, to: "v_confirm text := 'staging'" },
    report: /RELATORIO\s+(\S+)[^:]*:\s*(\d+)\s+FAIL\s+de\s+(\d+)/,
  },
};

describe('rebuild-drill (PGlite)', () => {
  it('ciclo 0001 IGUAL, testes lidos do RAISE, e pára na primeira migração com erro', async () => {
    const root = repo({ ...base, 'db/migrations/0002_c.sql': 'create table public.v (x int references public.nao_existe(id));',
      'db/migrations/0002_c.rollback.sql': 'drop table public.v;' });
    const s = await runDrill({ root, roundtrip: '0001', tests, out: join(root, 'out'), log: () => {} });
    expect(s.migracoes).toEqual(['0000_a.sql', '0001_b.sql']);
    expect(s.erro.ficheiro).toBe('0002_c.sql');
    expect(s.erro.mensagem).toMatch(/nao_existe/);
    expect(s.ciclo.testes).toMatchObject({ estado: 'OK', fail: 0, total: 1 });
    expect(s.ciclo.residuoTestes).toBe(true);
    expect(s.ciclo.rollbackIgual).toBe(true);
    expect(s.ciclo.reaplicacaoIgual).toBe(true);
    expect(s.ciclo.reaplicacaoDirecta.abortou).toBe(true);
    expect(s.ok).toBe(false);
  }, 180_000);

  it('rollback incompleto dá DIFERENTE e aponta o facto que ficou', async () => {
    const root = repo({ ...base, 'db/migrations/0001_b.rollback.sql': 'drop table public.u;' });
    const s = await runDrill({ root, roundtrip: '0001', tests: {}, out: join(root, 'out'), log: () => {} });
    expect(s.ciclo.rollbackIgual).toBe(false);
    // a função que ficou impede a reaplicação: o ensaio pára e diz porquê
    expect(s.erro.ficheiro).toBe('0001_b.sql');
    expect(s.erro.mensagem).toMatch(/reaplicação falhou/);
    expect(s.ciclo.rollbackDiff.added.some((l: string) => l.startsWith('fn|public.f()'))).toBe(true);
    expect(s.ok).toBe(false);
  }, 180_000);

  it('utilitários: diffLines e CSV', () => {
    expect(diffLines(['a', 'b'], ['b', 'c'])).toEqual({ removed: ['a'], added: ['c'] });
    expect(toCsv(['a', 'b'], [{ a: 'x,y', b: 'q"z' }])).toBe('a,b\n"x,y","q""z"\n');
  });
});
