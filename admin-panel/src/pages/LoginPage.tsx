import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';

export function LoginPage() {
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F3F0]">
      <div className="bg-white rounded-xl shadow-sm border p-8 w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-vivere-dark">Vivere</h1>
          <p className="text-sm text-gray-500 mt-1">Painel Administrativo</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vivere-teal"
              placeholder="admin@vivere.local"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vivere-teal"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-vivere-teal hover:bg-teal-700 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isLoading ? 'A entrar...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
