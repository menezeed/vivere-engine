import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionRunRepository } from '../IngestionRunRepository';

function makeDb(overrides: Record<string, unknown> = {}) {
  const single = vi.fn().mockResolvedValue({ data: { id: 'run-uuid-123' }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockResolvedValue({ data: null, error: null });
  const eq = vi.fn().mockReturnValue({ data: null, error: null, ...overrides });
  const from = vi.fn().mockReturnValue({ insert, update: vi.fn().mockReturnValue({ eq }) });
  const schema = vi.fn().mockReturnValue({ from });

  return { schema, from, insert, update, eq, select, single };
}

describe('IngestionRunRepository.start', () => {
  it('insere um registro com status running e retorna o id', async () => {
    const db = makeDb();
    const repo = new IngestionRunRepository(db as never);

    const runId = await repo.start('prefeitura_cabo_frio');

    expect(runId).toBe('run-uuid-123');
    expect(db.schema).toHaveBeenCalledWith('staging');
  });

  it('lança erro quando o banco retorna error', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'FK violation' } });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    const schema = vi.fn().mockReturnValue({ from });
    const db = { schema };

    const repo = new IngestionRunRepository(db as never);

    await expect(repo.start('source_inexistente')).rejects.toThrow('FK violation');
  });
});

describe('IngestionRunRepository.finish', () => {
  it('atualiza status para success com contagens corretas', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const schema = vi.fn().mockReturnValue({ from });
    const db = { schema };

    const repo = new IngestionRunRepository(db as never);
    await repo.finish('run-uuid-123', { itemsCollected: 12, itemsErrored: 2 });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', items_collected: 12, items_errored: 2 }),
    );
    expect(eq).toHaveBeenCalledWith('id', 'run-uuid-123');
  });

  it('lança erro quando o banco retorna error', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const schema = vi.fn().mockReturnValue({ from });
    const db = { schema };

    const repo = new IngestionRunRepository(db as never);
    await expect(repo.finish('run-uuid-123', { itemsCollected: 0, itemsErrored: 0 })).rejects.toThrow('timeout');
  });
});

describe('IngestionRunRepository.markFailed', () => {
  it('atualiza status para failed', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const schema = vi.fn().mockReturnValue({ from });
    const db = { schema };

    const repo = new IngestionRunRepository(db as never);
    await repo.markFailed('run-uuid-123', 'API rate limit');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('NÃO lança erro mesmo quando o UPDATE do banco falha — erro original tem precedência', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'connection lost' } });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const schema = vi.fn().mockReturnValue({ from });
    const db = { schema };

    const repo = new IngestionRunRepository(db as never);
    // Não deve lançar — markFailed é chamado no catch e não deve mascarar o erro original
    await expect(repo.markFailed('run-uuid-123', 'original error')).resolves.toBeUndefined();
  });
});
