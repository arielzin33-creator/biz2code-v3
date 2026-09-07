

import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { PhasePage } from './pages/PhasePage';
import { DocumentsPage } from './pages/DocumentsPage';


function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, restoring } = useAuth();
  const location = useLocation();

  if (restoring) {
    return (
      <main style={{ padding: 40, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
        Restoring your session…
      </main>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppShell>{children}</AppShell>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/projects" element={<ProtectedRoute><ProjectsPage /></ProtectedRoute>} />
      <Route
        path="/projects/:projectId/phase/:phaseNo"
        element={<ProtectedRoute><PhasePage /></ProtectedRoute>}
      />
      <Route
        path="/projects/:projectId/documents"
        element={<ProtectedRoute><DocumentsPage /></ProtectedRoute>}
      />

      <Route path="/" element={<Navigate to="/projects" replace />} />
      {}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
