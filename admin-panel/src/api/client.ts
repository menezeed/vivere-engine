// Import relativo (e não '@/config') para que este módulo possa ser testado
// pelo Vitest da raiz, que não conhece o alias '@'.
import { config } from '../config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }
}

/**
 * SEC-A: evento global emitido quando o Review API responde 403. O AppShell
 * ouve-o para mostrar "acesso negado". A sessão NÃO é terminada: o token
 * continua válido, só falta permissão.
 */
export const ACCESS_DENIED_EVENT = 'vivere:access-denied';

export const ACCESS_DENIED_MESSAGE =
  'Acesso negado: a sua conta não tem permissão para esta operação. ' +
  'Peça a um administrador que lhe atribua um papel (viewer, reviewer ou admin).';

export function isAccessDenied(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

/** Mensagem legível para toasts; 403 tem texto próprio. */
export function describeApiError(err: unknown): string {
  if (isAccessDenied(err)) return ACCESS_DENIED_MESSAGE;
  return String(err);
}

/**
 * Política de retry das queries: como antes, uma repetição — excepto 401 e
 * 403 (SEC-A), que não se resolvem repetindo o pedido.
 */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
  if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return false;
  return failureCount < 1;
}

function getToken(): string | null {
  return localStorage.getItem('vivere_access_token');
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();

  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // 401 = sem sessão válida (token ausente, inválido ou expirado) → login.
  if (res.status === 401) {
    localStorage.removeItem('vivere_access_token');
    window.location.href = '/login';
    throw new ApiError(401, { error: 'Sessão expirada' });
  }

  // 403 = sessão válida mas sem permissão → avisar, sem logout.
  if (res.status === 403) {
    const body = await res.json().catch(() => null);
    window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT, { detail: { path } }));
    throw new ApiError(403, body);
  }

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }

  return data as T;
}
