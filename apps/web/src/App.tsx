import { Navigate, Route, Routes } from 'react-router-dom';

import ProtectedRoute from './components/ProtectedRoute';
import CampaignDetailPage from './pages/CampaignDetailPage';
import CampaignNewPage from './pages/CampaignNewPage';
import CampaignsListPage from './pages/CampaignsListPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

/**
 * F5 — Routing shell.
 *
 * Public:
 *   /login, /register
 * Protected (require zustand `token`; otherwise <Navigate to="/login" />):
 *   /campaigns, /campaigns/new, /campaigns/:id
 * Catch-alls:
 *   /  -> redirect to /campaigns
 *   *  -> redirect to /campaigns
 *
 * The `<ProtectedRoute>` wrapper handles the missing-token case at mount.
 * Mid-session token expiry (401) is handled by the axios response
 * interceptor in `lib/api.ts` (logout + window.location.href = '/login').
 */
export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/campaigns"
        element={
          <ProtectedRoute>
            <CampaignsListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/campaigns/new"
        element={
          <ProtectedRoute>
            <CampaignNewPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/campaigns/:id"
        element={
          <ProtectedRoute>
            <CampaignDetailPage />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/campaigns" replace />} />
      <Route path="*" element={<Navigate to="/campaigns" replace />} />
    </Routes>
  );
}
