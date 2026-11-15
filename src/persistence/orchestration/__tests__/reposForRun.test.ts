import { describe, it, expect, vi } from 'vitest';
import { reposForRun, dryRunRepositories } from '../reposForRun';
import type { IRepositorySet } from '../../types/repositoryInterfaces';

describe('reposForRun', () => {
  it('dry-run não chama createRepos e devolve repositórios que falham em qualquer acesso', async () => {
    const createRepos = vi.fn(async () => ({}) as IRepositorySet);
    const repos = await reposForRun(true, createRepos);
    expect(createRepos).not.toHaveBeenCalled();
    expect(() => repos.rawActivityItem).toThrow(/dry-run: acesso a repositórios não permitido \(rawActivityItem\)/);
    expect(() => repos.ingestionRun).toThrow(/ingestionRun/);
  });

  it('modo real chama createRepos uma vez e devolve o resultado', async () => {
    const real = { marker: true } as unknown as IRepositorySet;
    const createRepos = vi.fn(async () => real);
    expect(await reposForRun(false, createRepos)).toBe(real);
    expect(createRepos).toHaveBeenCalledTimes(1);
  });

  it('o proxy de dry-run não é thenable (pode ser devolvido por funções async)', async () => {
    await expect(Promise.resolve(dryRunRepositories())).resolves.toBeDefined();
  });
});
