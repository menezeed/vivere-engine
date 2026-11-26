import { ApiError } from '@/api/client';
import { config } from '@/config';

/**
 * Mostra a falha de uma query de listagem. Sem isto, uma Review API parada
 * (fetch rejeitado) ou um erro HTTP apareciam como "lista vazia".
 * 401/403 já têm tratamento próprio no client (login / aviso de acesso).
 */
export function QueryErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const detail = error instanceof ApiError
    ? `HTTP ${error.status}`
    : 'sem resposta (a Review API está a correr?)';
  return (
    <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      Não foi possível carregar os dados da Review API em {config.apiBaseUrl || '(VITE_API_BASE_URL vazio)'}: {detail}.
      A lista abaixo não reflecte o staging.
    </div>
  );
}
