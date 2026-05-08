import axios from 'axios';

import { useAuthStore } from '../store/auth';

/**
 * F5 — Axios instance + JWT interceptor + 401 handler.
 *
 * Architect-defined contract (filled in by frontend agent):
 *
 * ## Request interceptor
 *
 *   - Reads the current token via `useAuthStore.getState().token`
 *     (`getState()`, not the React hook — interceptors run OUTSIDE the
 *     React render tree).
 *   - If non-null, sets `config.headers.Authorization = 'Bearer ${token}'`.
 *   - Never overwrites an explicit Authorization header set by the caller.
 *   - Always returns `config` so public endpoints (login/register) still go.
 *
 * ## Response interceptor
 *
 *   - Pass successful responses through unchanged.
 *   - On 401: clear in-memory auth (`useAuthStore.getState().logout()`) and
 *     hard-redirect to `/login` (skipping when already on `/login` to avoid
 *     a redirect loop). Then `Promise.reject(error)` so the caller still
 *     receives the failure.
 *   - Non-401 errors are forwarded; UI components map `error.code` to
 *     user-readable copy via `messageFor` from `types/api-error.ts`.
 *
 * ## baseURL
 *
 * `VITE_API_BASE_URL` (set in `apps/web/.env` for dev) wins; falls back to
 * `http://localhost:4000` when the env var is missing.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000',
  timeout: 10_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      useAuthStore.getState().logout();
      // Avoid a redirect loop while already on /login.
      if (
        typeof window !== 'undefined' &&
        !window.location.pathname.startsWith('/login')
      ) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);
