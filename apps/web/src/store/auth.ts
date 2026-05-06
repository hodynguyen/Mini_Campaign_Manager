import { create } from 'zustand';

/**
 * Auth store skeleton — F1 placeholder.
 * Real login/logout wiring lands in F4 alongside the /login page and the
 * axios JWT interceptor. JWT is held in memory only (per ASSIGNMENT.md guidance).
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  setAuth: (token, user) => set({ token, user }),
  clear: () => set({ token: null, user: null }),
}));
