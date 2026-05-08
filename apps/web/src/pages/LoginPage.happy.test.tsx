import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type * as RR from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import LoginPage from './LoginPage';

/**
 * F5 component test: LoginPage happy path.
 *
 * - Mocks `api.post('/auth/login')` -> 200 with `{ token, user }`.
 * - Mocks `react-router-dom`'s `useNavigate` so we can assert navigation
 *   without a `<Routes>` shell — simpler than introspecting MemoryRouter
 *   history (per architect's hand-off recommendation).
 * - After submit, asserts:
 *     1. `useAuthStore.getState().token === 'abc'` (login() was called).
 *     2. `navigate('/campaigns', { replace: true })` was called (matches
 *        useLoginMutation onSuccess in `hooks/useAuth.ts`).
 */
vi.mock('../lib/api', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof RR>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderLogin() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LoginPage — happy path', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
    navigateMock.mockReset();
    (api.post as Mock).mockReset();
  });
  afterEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  it('submits credentials, stores auth, and navigates to /campaigns', async () => {
    (api.post as Mock).mockResolvedValueOnce({
      data: {
        token: 'abc',
        user: {
          id: 'u-1',
          email: 'jane@example.com',
          name: 'Jane',
          created_at: '2026-05-08T00:00:00.000Z',
        },
      },
    });

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/password/i), 'supersecret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Wait for the mutation to resolve and onSuccess to run.
    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe('abc');
    });
    expect(useAuthStore.getState().user?.email).toBe('jane@example.com');
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      email: 'jane@example.com',
      password: 'supersecret',
    });
    expect(navigateMock).toHaveBeenCalledWith('/campaigns', { replace: true });
  });
});
