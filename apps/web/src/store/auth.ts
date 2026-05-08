import { create } from 'zustand';

import type { AuthResponse, User } from '@app/shared';

/**
 * F5 — Auth store.
 *
 * Per ADR-003 (accepted in F5 finalize), the JWT lives ONLY in memory:
 * - No `localStorage` / `sessionStorage` persistence.
 * - Refreshing the page clears auth state; the user must log in again.
 * This is a deliberate UX trade-off (assignment scope) — no CSRF surface,
 * no XSS-readable token, no cookie/CORS plumbing.
 *
 * Read patterns:
 *  - Inside React components: `const token = useAuthStore(s => s.token);`
 *  - Outside components (axios interceptor, react-query global error handler):
 *      `useAuthStore.getState().token`
 *      `useAuthStore.getState().logout()`
 */
export interface AuthState {
  token: string | null;
  user: User | null;
  /** Stash auth from a successful /auth/login (or /auth/register auto-login) response. */
  login: (auth: AuthResponse) => void;
  /** Clear token + user. Caller is responsible for navigating to /login. */
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  login: (auth) => set({ token: auth.token, user: auth.user }),
  logout: () => set({ token: null, user: null }),
}));
