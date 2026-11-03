import type { UserRole } from '../types/review';

/** Papéis aceites (ADR-0009). Espelha VALID_ROLES do Review API. */
export const VALID_ROLES: readonly UserRole[] = ['viewer', 'reviewer', 'admin'];

/**
 * SEC-A: devolve o papel só se for exactamente um dos três aceites.
 * Qualquer outro valor (ausente, vazio, desconhecido) é null — "sem papel".
 * Não há papel por omissão.
 */
export function parseUserRole(value: unknown): UserRole | null {
  return typeof value === 'string' && (VALID_ROLES as readonly string[]).includes(value)
    ? (value as UserRole)
    : null;
}
