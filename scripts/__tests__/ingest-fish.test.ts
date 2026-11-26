/**
 * scripts/ingest-fish.ts: guardas do modo de escrita e dry-run sem BD nem rede.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../ingest-fish';

const created: string[] = [];
afterEach(() => { for (const f of created.splice(0)) unlinkSync(f); vi.restoreAllMocks(); });

function snapshotFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-fish-'));
  const file = join(dir, 'snap.json');
  writeFileSync(file, JSON.stringify({
    gerado_em: '2026-11-26T11:59:21.300Z', hoje: '2026-11-26', dry_run: true, escrita_em_bd: false,
    fonte: { source_key: 'fish_neighbourhood_care', ics_url: 'https://www.fishhelp.org.uk/events/list/?ical=1', pedidos_http: 1 },
    produto: 'vivere-60-plus-uk-test',
    atividades: [{
      source_item_id: 'series:coffee:wed:1030', titulo: 'Coffee', url_oficial: 'https://www.fishhelp.org.uk/event/coffee/2026-12-02/',
      urls_ocorrencias: ['https://www.fishhelp.org.uk/event/coffee/2026-12-02/'], publico_alvo: [], evidencia_60plus: null,
      datas: ['2026-12-02'], horario: ['10:30–12:00'], fuso: 'Europe/London', local: null, local_varia_entre_ocorrencias: false,
      custo: null, gratuito_declarado: false, inscricao: { reserva: 'drop_in', transporte_disponivel: false },
      disponibilidade: 'aberto (sem reserva)', categorias: ['Coffee'], titulo_pode_ter_nome_de_pessoa: false,
      elegibilidade_proposta: { physical_activity: false },
    }],
  }));
  created.push(file);
  return file;
}

describe('ingest-fish', () => {
  it('--apply sem --confirm=staging é recusado antes de qualquer leitura', async () => {
    await expect(main(['node', 'x', '--snapshot=/nao/existe.json', '--apply'])).rejects.toThrow(/confirm=staging/);
  });

  it('sem --snapshot é recusado (não há recolha nova)', async () => {
    await expect(main(['node', 'x'])).rejects.toThrow(/--snapshot/);
  });

  it('dry-run: sem fetch, sem BD; relatório com as linhas previstas', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const snap = snapshotFile();
    const report = `${snap}.out.json`;
    await main(['node', 'x', `--snapshot=${snap}`, '--today=2026-11-26', `--report=${report}`]);
    created.push(report);
    expect(fetchSpy).not.toHaveBeenCalled();
    const r = JSON.parse(readFileSync(report, 'utf8'));
    expect(r.modo).toMatch(/DRY-RUN/);
    expect(r.contagens.a_inserir).toBe(1);
    expect(r.linhas_previstas['staging.raw_activity_items']).toBe(1);
    expect(r.resultado_escrita).toBeNull();
    expect(r.escrita_efetuada).toBe(false);
    expect(r.linhas_gravadas).toBe(0);
    expect(r.snapshot.pedidos_http_nesta_execucao).toBe(0);
  });
});
