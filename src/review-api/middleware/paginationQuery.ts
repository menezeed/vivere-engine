/**
 * Validação dos parâmetros de paginação na query string (19/11/2026).
 *
 * Antes, page / pageSize / limit iam por Number(...) directo: "abc" dava NaN,
 * "1.5" um offset fraccionário e "-1" ou "1e9" passavam. NaN e fracções
 * chegavam ao PostgREST (.range / .limit), que recusava: a rota devolvia 500
 * "Erro interno" e registava um erro por pedido. Agora → 400 genérico, sem
 * consultar a base.
 *
 * CONTRATO: ausente ou vazio → o valor por omissão de cada rota (como antes);
 * presente → só dígitos decimais, no máximo 9 (inteiro ≥ 0, sempre seguro).
 * Os limites de cada rota (page ≥ 1, pageSize ≤ 100, limit ≤ 100) continuam a
 * ser aplicados por clamp depois desta validação.
 */
import type { Context } from 'hono';

export const PAGINATION_INT_RE = /^[0-9]{1,9}$/;

/** Resposta 400 se algum dos parâmetros estiver presente e não for inteiro válido; senão null. */
export function rejectInvalidIntQuery(c: Context, names: readonly string[]): Response | null {
  for (const name of names) {
    const value = c.req.query(name);
    if (value !== undefined && value !== '' && !PAGINATION_INT_RE.test(value)) {
      return c.json({ error: `Parâmetro de paginação inválido: ${name}` }, 400);
    }
  }
  return null;
}
