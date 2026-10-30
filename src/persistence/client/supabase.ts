import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertEnvironment, ENV_VAR_NAMES } from '../../lib/envGuard.js';

let _client: SupabaseClient | null = null;

/**
 * Retorna o cliente Supabase singleton para uso pelos repositórios.
 *
 * SEC-O (fase 2A): antes de criar o cliente, valida o ambiente com
 * assertEnvironment(). Exige VIVERE_ENV=staging, o SUPABASE_URL exacto do
 * staging e uma SUPABASE_SERVICE_KEY de formato válido; a produção está
 * bloqueada incondicionalmente. Qualquer falha lança EnvGuardError ANTES de
 * createClient() e de qualquer pedido de rede, e as mensagens nunca incluem
 * a chave. Se a guarda falhar, o singleton não é criado (a chamada seguinte
 * volta a validar).
 *
 * A validação corre só quando o cliente é criado; depois disso o singleton
 * é devolvido tal como estava (o cliente já ficou ligado ao URL validado).
 *
 * Usa a SERVICE_KEY (não a anon key) porque a engine escreve em
 * staging.* e precisa de permissão além do que a anon key dá.
 * O app mobile usa a anon key separadamente — nunca compartilham
 * a mesma chave.
 *
 * Para dry-run (sem banco), não chame getSupabaseClient().
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  // Fotografia das variáveis que a guarda lê: o que é validado é exactamente
  // o que é usado a seguir (sem janela entre validar e criar).
  const snapshot: NodeJS.ProcessEnv = {};
  for (const name of Object.values(ENV_VAR_NAMES)) {
    snapshot[name] = process.env[name];
  }

  // Lança EnvGuardError se o ambiente não for exactamente o staging declarado.
  const { supabaseUrl } = assertEnvironment(snapshot);

  // Presente e com formato válido: garantido por assertEnvironment() acima.
  const key = snapshot[ENV_VAR_NAMES.serviceKey] as string;

  _client = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _client;
}

/** Reseta o singleton — usado nos testes para injetar um mock. */
export function _resetSupabaseClient(): void {
  _client = null;
}
