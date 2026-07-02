import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Retorna o cliente Supabase singleton para uso pelos repositórios.
 * Lança imediatamente se SUPABASE_URL ou SUPABASE_SERVICE_KEY não
 * estiverem definidos — falha ruidosa, nunca silenciosa.
 *
 * Usa a SERVICE_KEY (não a anon key) porque a engine escreve em
 * staging.* e precisa de permissão além do que a anon key dá.
 * O app mobile usa a anon key separadamente — nunca compartilham
 * a mesma chave.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios para persistência real. ' +
        'Para dry-run (sem banco), não chame getSupabaseClient().',
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _client;
}

/** Reseta o singleton — usado nos testes para injetar um mock. */
export function _resetSupabaseClient(): void {
  _client = null;
}
