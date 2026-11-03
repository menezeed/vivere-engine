import { ShieldOff, LogOut } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { ACCESS_DENIED_MESSAGE } from '@/api/client';

/**
 * SEC-A: ecrã para uma conta autenticada sem papel atribuído. Não faz
 * pedidos ao Review API (todos dariam 403) e não termina a sessão sozinho:
 * o utilizador vê o motivo e sai quando quiser.
 */
export function AccessDenied() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div role="alert" className="max-w-md w-full bg-white rounded-lg shadow p-8 text-center">
        <ShieldOff className="mx-auto text-red-500 mb-4" size={36} />
        <h1 className="text-lg font-bold text-vivere-dark">Acesso negado</h1>
        <p className="text-sm text-gray-600 mt-2">{ACCESS_DENIED_MESSAGE}</p>
        {user?.email && <p className="text-xs text-gray-400 mt-4">Sessão: {user.email}</p>}
        <button
          onClick={logout}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded bg-vivere-dark text-white text-sm hover:opacity-90"
        >
          <LogOut size={14} />
          Sair
        </button>
      </div>
    </div>
  );
}
