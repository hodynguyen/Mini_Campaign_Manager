import { Navigate } from 'react-router-dom';

import { useAuthStore } from '../store/auth';

/**
 * F5 — Route guard. If the zustand store has no token, redirect to /login;
 * otherwise render children. The 401 flow (token-expired mid-session) is
 * separately handled by the axios response interceptor in `lib/api.ts`,
 * which clears the store and hard-redirects to /login.
 *
 * Implementation note: this component IS NOT a skeleton — it's small enough
 * and the logic is locked. Frontend agent doesn't need to fill it in.
 */
export interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({
  children,
}: ProtectedRouteProps): JSX.Element {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
