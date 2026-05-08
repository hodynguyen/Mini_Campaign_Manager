import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import type * as RR from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import LoginPage from './LoginPage';

/**
 * F5 component test: LoginPage 401 path.
 *
 * Mocks `api.post('/auth/login')` to reject with a real AxiosError so
 * `axios.isAxiosError(err)` returns true inside `extractApiError`. The
 * payload uses code `INVALID_CREDENTIALS`, which the locked
 * `ERROR_MESSAGES` map (`types/api-error.ts`) translates to
 * `"Invalid email or password."` — note the trailing period that comes from
 * the `messageFor` mapping, NOT from the API's raw message
 * (`"Invalid email or password"` — no period). Asserting the rendered text
 * INCLUDES the trailing period proves the UI went through `messageFor` and
 * not `error.message`, which is the load-bearing UX rule.
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

describe('LoginPage — 401 invalid credentials', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
    navigateMock.mockReset();
    (api.post as Mock).mockReset();
  });
  afterEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  it('shows the messageFor-translated error when the API returns 401', async () => {
    // Build a real AxiosError so `axios.isAxiosError()` returns true and
    // `extractApiError` walks the api-error envelope branch.
    const apiErr = new AxiosError(
      // The raw API message — distinct from the messageFor translation.
      'Invalid email or password',
      'ERR_BAD_REQUEST',
      undefined,
      undefined,
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        },
      },
    );
    (api.post as Mock).mockRejectedValueOnce(apiErr);

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // The locked `ERROR_MESSAGES.INVALID_CREDENTIALS` is
    // "Invalid email or password." (with trailing period). Matching the
    // exact mapped string proves we went through `messageFor`, not
    // `error.message` (which has NO period).
    await waitFor(() => {
      expect(
        screen.getByText('Invalid email or password.'),
      ).toBeInTheDocument();
    });

    // Side-effects: NO auth stored, NO navigation triggered.
    expect(useAuthStore.getState().token).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
