import { config } from '@/config';
import type { AuthUser } from '@/types/review';

interface SupabaseAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    app_metadata: { role?: string };
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
    role:  (data.user.app_metadata.role as AuthUser['role']) ?? 'viewer',
  };

  return { token: data.access_token, user };
}
