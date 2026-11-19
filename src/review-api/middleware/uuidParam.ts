/**
 * Validação de parâmetros de caminho que são UUID (19/11/2026).
 *
 * Antes, um :id / :activityId que não fosse UUID chegava ao Postgres, que
 * respondia "invalid input syntax for type uuid": a rota devolvia 500
 * "Erro interno" e registava um erro por pedido. Agora → 400 genérico, sem
 * consultar a base. É montado DENTRO de cada router, por isso corre depois
 * da autenticação e das guardas de papel (401/403 continuam primeiro).
 */
import type { MiddlewareHandler } from 'hono';

/**
 * CONTRATO: só o formato CANÓNICO com hífenes (8-4-4-4-12, qualquer versão
 * ou variante, maiúsculas ou minúsculas). É o único que a API e o
 * admin-panel produzem (os ids vêm sempre do Postgres, que os imprime assim).
 * Formas que o PostgreSQL também aceitaria na entrada (sem hífenes, entre
 * chavetas, …) são recusadas com 400 de propósito: uma só representação por
 * recurso (revisão r0 do #35).
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuidParam(name: string): MiddlewareHandler {
  return async (c, next) => {
    const value = c.req.param(name);
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      return c.json({ error: 'Identificador inválido' }, 400);
    }
    await next();
  };
}
