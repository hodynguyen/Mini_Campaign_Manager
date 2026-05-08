/**
 * F5 — Auth hooks.
 *
 * Architect-locked signatures:
 *  - `useLoginMutation()`     -> POST /auth/login -> store auth + navigate.
 *  - `useRegisterMutation()`  -> POST /auth/register, then auto-login.
 *  - `useLogout()`            -> clear store + react-query cache + navigate /login.
 *
 * The login + register mutations both end at the same place (auth in store +
 * `/campaigns`); RegisterPage doesn't need to compose two mutations because
 * `useRegisterMutation` chains the login internally and returns the
 * AuthResponse from the second call. This keeps the page bodies linear.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  User,
} from '@app/shared';

import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

/**
 * Login mutation — POST /auth/login.
 *
 * On success: stash `{ token, user }` in zustand and navigate to /campaigns.
 * On error: caller renders an `<ErrorAlert>` (no global side-effect here).
 */
export function useLoginMutation(): UseMutationResult<
  AuthResponse,
  unknown,
  LoginRequest
> {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (input: LoginRequest) => {
      const { data } = await api.post<AuthResponse>('/auth/login', input);
      return data;
    },
    onSuccess: (data) => {
      login(data);
      navigate('/campaigns', { replace: true });
    },
  });
}

/**
 * Register mutation — POST /auth/register, then auto-login via /auth/login.
 *
 * The mutationFn returns the User from /auth/register so the type matches the
 * locked signature (`UseMutationResult<User, ...>`); the auth response from
 * the auto-login is dropped into the store inside the function before
 * returning. RegisterPage just observes `mutation.isSuccess`.
 */
export function useRegisterMutation(): UseMutationResult<
  User,
  unknown,
  RegisterRequest
> {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (input: RegisterRequest) => {
      const { data: user } = await api.post<User>('/auth/register', input);
      const { data: auth } = await api.post<AuthResponse>('/auth/login', {
        email: input.email,
        password: input.password,
      });
      login(auth);
      return user;
    },
    onSuccess: () => {
      navigate('/campaigns', { replace: true });
    },
  });
}

/**
 * Logout callback — clears zustand, drops cached server state from the
 * previous user, navigates to /login. Distinct from the axios 401 handler
 * (which uses `window.location.href` because it runs outside React).
 */
export function useLogout(): () => void {
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const qc = useQueryClient();
  return useCallback(() => {
    logout();
    qc.clear();
    navigate('/login', { replace: true });
  }, [logout, qc, navigate]);
}
