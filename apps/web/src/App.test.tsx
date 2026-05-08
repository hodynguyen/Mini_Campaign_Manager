import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from './App';
import { useAuthStore } from './store/auth';

/**
 * F5 baseline routing smoke.
 *  - Unauthenticated visit to `/` -> redirect chain -> /login -> LoginPage.
 *  - LoginPage now renders the real form ("Sign in" heading + email field).
 */
function renderApp() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App routing shell', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });
  afterEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  it('redirects unauthenticated users from / to /login', () => {
    renderApp();
    // Heading on the LoginPage card.
    expect(
      screen.getByRole('heading', { name: /sign in/i }),
    ).toBeInTheDocument();
  });
});
