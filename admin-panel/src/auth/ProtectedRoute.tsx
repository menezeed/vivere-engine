import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { AccessDenied } from '@/components/shared/AccessDenied';
import type { ReactNode } from 'react';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // SEC-A: autenticado mas sem papel → acesso negado, sem chamar a API.
  if (user?.role === null) return <AccessDenied />;
  return <>{children}</>;
}
