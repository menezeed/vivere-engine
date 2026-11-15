import { describe, expect, it, vi } from 'vitest';
import { parseArchiveArgs, runArchive } from '../archive-activity.js';

const ID = '0b9c6f8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';

function repos(state: unknown) {
  return {
    publicActivity: { findPublicationStateByEngineId: vi.fn().mockResolvedValue(state) },
    run: { start: vi.fn().mockResolvedValue('run-1'), finish: vi.fn().mockResolvedValue(undefined), markFailed: vi.fn().mockResolvedValue(undefined) },
    event: { record: vi.fn() },
  } as never;
}

describe('archive-activity', () => {
  it('argumentos: exige product-key e UUID; recusa desconhecidos', () => {
    expect(parseArchiveArgs([`--product-key=p`, `--engine-activity-id=${ID}`])).toEqual({ productKey: 'p', engineActivityId: ID, confirm: false });
    expect(parseArchiveArgs([`--product-key=p`, `--engine-activity-id=${ID}`, '--confirm']).confirm).toBe(true);
    expect(() => parseArchiveArgs([`--engine-activity-id=${ID}`])).toThrow(/product-key/);
    expect(() => parseArchiveArgs(['--product-key=p', '--engine-activity-id=x'])).toThrow(/UUID/);
    expect(() => parseArchiveArgs(['--product-key=p', `--engine-activity-id=${ID}`, '--force'])).toThrow(/desconhecido/);
  });

  it('sem --confirm só lê: nenhuma run, nenhum arquivo', async () => {
    const r = repos({ publicActivityId: 'pub-1', lastPublishedAt: new Date(), engineStatus: 'active' });
    const archive = vi.fn();
    const out = await runArchive(r, archive, { productKey: 'p', engineActivityId: ID, confirm: false });
    expect(out).toEqual({ kind: 'would_archive', publicActivityId: 'pub-1' });
    expect(archive).not.toHaveBeenCalled();
    expect((r as any).run.start).not.toHaveBeenCalled();
  });

  it('com --confirm arquiva e fecha a run com activitiesArchived=1', async () => {
    const r = repos({ publicActivityId: 'pub-1', lastPublishedAt: new Date(), engineStatus: 'active' });
    const archive = vi.fn().mockResolvedValue(undefined);
    const out = await runArchive(r, archive, { productKey: 'p', engineActivityId: ID, confirm: true });
    expect(out).toEqual({ kind: 'archived', publicActivityId: 'pub-1', runId: 'run-1' });
    expect(archive).toHaveBeenCalledWith(ID, 'run-1', 'p');
    expect((r as any).run.start).toHaveBeenCalledWith('p', 'manual-archive');
    expect((r as any).run.finish.mock.calls[0][1].activitiesArchived).toBe(1);
  });

  it('inexistente e já arquivada: nada é escrito', async () => {
    const archive = vi.fn();
    expect(await runArchive(repos(null), archive, { productKey: 'p', engineActivityId: ID, confirm: true })).toEqual({ kind: 'not_found' });
    const r = repos({ publicActivityId: 'pub-1', lastPublishedAt: new Date(), engineStatus: 'archived' });
    expect((await runArchive(r, archive, { productKey: 'p', engineActivityId: ID, confirm: true })).kind).toBe('already_archived');
    expect(archive).not.toHaveBeenCalled();
  });

  it('falha ao arquivar marca a run como falhada e propaga o erro', async () => {
    const r = repos({ publicActivityId: 'pub-1', lastPublishedAt: new Date(), engineStatus: 'active' });
    const archive = vi.fn().mockRejectedValue(new Error('rede'));
    await expect(runArchive(r, archive, { productKey: 'p', engineActivityId: ID, confirm: true })).rejects.toThrow('rede');
    expect((r as any).run.markFailed).toHaveBeenCalledWith('run-1', 'rede');
    expect((r as any).run.finish).not.toHaveBeenCalled();
  });
});

describe('archive-activity — fecho da run', () => {
  it('fecho da run falha depois do arquivo: marca a run como falhada e propaga', async () => {
    const r = repos({ publicActivityId: 'pub-1', lastPublishedAt: new Date(), engineStatus: 'active' });
    (r as any).run.finish.mockRejectedValue(new Error('db'));
    const archive = vi.fn().mockResolvedValue(undefined);
    await expect(runArchive(r, archive, { productKey: 'p', engineActivityId: ID, confirm: true })).rejects.toThrow('db');
    expect(archive).toHaveBeenCalledTimes(1);
    expect((r as any).run.markFailed.mock.calls[0][1]).toMatch(/arquivo feito/);
  });
});
