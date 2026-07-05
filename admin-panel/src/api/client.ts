import { config } from '@/config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }
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

  if (res.status === 401) {
    localStorage.removeItem('vivere_access_token');
    window.location.href = '/login';
    throw new ApiError(401, { error: 'Sessão expirada' });
  }

  const data = await res.json();

  if (!res.ok) {
    throw new ApiError(res.status, data);
  }

  return data as T;
}
