import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import { ToastProvider } from '@/components/ui/Toast';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { VenuesPage } from '@/pages/VenuesPage';
import { VenueDetailPage } from '@/pages/VenueDetailPage';
import { ActivitiesPage } from '@/pages/ActivitiesPage';
import { ActivityDetailPage } from '@/pages/ActivityDetailPage';
import { IngestionRunsPage } from '@/pages/IngestionRunsPage';
import { EntityResolutionPage } from '@/pages/EntityResolutionPage';function SettingsPage() {
  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-vivere-dark">Settings</h1>
      <p className="text-sm text-gray-400 mt-1">Em breve.</p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard"          element={<DashboardPage />} />
              <Route path="/venues"             element={<VenuesPage />} />
              <Route path="/venues/:id"         element={<VenueDetailPage />} />
              <Route path="/activities"         element={<ActivitiesPage />} />
              <Route path="/activities/:id"     element={<ActivityDetailPage />} />
              <Route path="/ingestion-runs"     element={<IngestionRunsPage />} />
              <Route path="/entity-resolution"  element={<EntityResolutionPage />} />
              <Route path="/settings"           element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
