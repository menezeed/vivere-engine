import { config } from '@/config';
import type { AuthUser } from '@/types/review';
import { parseUserRole } from './roles';

interface SupabaseAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    app_metadata?: { role?: unknown };
  };
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(
    `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabaseAnonKey,
      },
      body: JSON.stringify({ email, password }),
    },
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error_description ?? 'Falha no login');
  }

  const data: SupabaseAuthResponse = await res.json();

  const user: AuthUser = {
    id:    data.user.id,
    email: data.user.email,
    // SEC-A: sem fallback para 'viewer'. Papel ausente/inválido → null.
    role:  parseUserRole(data.user.app_metadata?.role),
  };

  return { token: data.access_token, user };
}
