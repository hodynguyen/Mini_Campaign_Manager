import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';

import App from './App';

describe('App', () => {
  it('renders the placeholder home with the app title', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Mini Campaign Manager/i)).toBeInTheDocument();
  });
});
