/**
 * scripts/__tests__/ingest-wordpress-content.test.ts
 *
 * Level 2, 2026-09-23 — São Pedro da Aldeia Simple Enablement +
 * correcção do entry-point guard (regressão de path no Windows).
 *
 * Guard original: `import.meta.url === \`file://${process.argv[1]}\``
 * Bug confirmado em produção real (Windows): comparação de strings falha
 * sempre (barras normais + URL encoding vs. barras invertidas nativas),
 * main() nunca corria ao executar o script directamente pela CLI — exit
 * code 0, nenhum erro visível, nenhuma ingestão real acontecia.
 *
 * Correcção: fileURLToPath(import.meta.url) — normaliza para o formato
 * de caminho nativo do SO antes de comparar. Portátil, sem lógica
 * condicional por plataforma.
 */

import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// ── main() NÃO corre ao importar o módulo ──────────────────────────────
//
// Prova explícita, não apenas ausência de erro: se main() corresse ao
// importar, chamaria RepositoryFactory.forSupabase() — o mock intercepta
// e confirma que isso nunca acontece. Declarado antes do import de
// AVAILABLE_INSTANCES (abaixo), para que o mock esteja activo quando o
// módulo for importado por qualquer teste deste ficheiro.

const { forSupabaseMock } = vi.hoisted(() => ({
  forSupabaseMock: vi.fn(),
}));

vi.mock('../../src/persistence/orchestration/RepositoryFactory.js', () => ({
  RepositoryFactory: { forSupabase: forSupabaseMock },
}));

import { AVAILABLE_INSTANCES } from '../ingest-wordpress-content.js';

describe('ingest-wordpress-content — entry-point guard', () => {
  it('importar o módulo NUNCA chama RepositoryFactory.forSupabase — main() não corre ao importar', () => {
    expect(forSupabaseMock).not.toHaveBeenCalled();
  });
});

// ── AVAILABLE_INSTANCES — resolução de configuração ─────────────────────

describe('ingest-wordpress-content — AVAILABLE_INSTANCES', () => {
  it('cabo-frio continua registada e resolve correctamente (regressão)', () => {
    const config = AVAILABLE_INSTANCES['cabo-frio'];
    expect(config).toBeDefined();
    expect(config!.source_key).toBe('prefeitura_cabo_frio');
    expect(config!.product_key).toBe('vivere-60-mais');
  });

  it('sao-pedro-da-aldeia está registada e resolve para source_key/product_key correctos', () => {
    const config = AVAILABLE_INSTANCES['sao-pedro-da-aldeia'];
    expect(config).toBeDefined();
    expect(config!.source_key).toBe('prefeitura_sao_pedro_da_aldeia');
    expect(config!.product_key).toBe('vivere-60-mais');
  });

  it('instância desconhecida não está registada', () => {
    expect(AVAILABLE_INSTANCES['instancia-inexistente']).toBeUndefined();
  });
});

// ── main() CORRE quando o script é executado directamente pela CLI ─────
//
// Testado via subprocess real (tsx), com --instance= inválido — este
// caminho sai por process.exit(1) ANTES de tocar em
// RepositoryFactory.forSupabase()/rede/Supabase (confirmado pelo próprio
// código: a verificação `if (!sourceConfig)` acontece logo no início de
// main(), antes de qualquer I/O). Seguro: nenhuma escrita, nenhuma
// chamada de rede real, mesmo correndo o processo real.
//
// Isto é exactamente o teste que teria apanhado a regressão original —
// no bug, main() nunca corria, o processo saía com exit code 0 e sem
// nenhuma mensagem; com o guard corrigido, corre e sai com exit code 1 e
// a mensagem "instância não encontrada".

describe('ingest-wordpress-content — execução directa pela CLI', () => {
  it('correr o script directamente com --instance inválido executa main() e sai com erro esperado (prova que o guard reconhece execução directa)', () => {
    const scriptPath = path.resolve(__dirname, '..', 'ingest-wordpress-content.ts');

    let stdoutAndStderr = '';
    let exitCode: number | null = 0;

    try {
      stdoutAndStderr = execFileSync(
        'npx',
        ['tsx', scriptPath, '--instance=instancia-que-nao-existe-neste-teste'],
        { encoding: 'utf-8', stdio: 'pipe', timeout: 30_000, shell: true },
      );
    } catch (err) {
      // execFileSync lança quando o processo sai com código != 0 —
      // exactamente o comportamento esperado aqui (process.exit(1)).
      const execErr = err as { status: number | null; stdout?: string; stderr?: string };
      exitCode = execErr.status;
      stdoutAndStderr = `${execErr.stdout ?? ''}${execErr.stderr ?? ''}`;
    }

    // No bug original, isto seria exitCode=0 e stdoutAndStderr vazio —
    // main() nunca teria corrido, nunca teria impresso nada.
    expect(exitCode).toBe(1);
    expect(stdoutAndStderr).toContain('instância não encontrada');
  });
});
