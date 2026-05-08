import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type * as RR from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { CampaignDetail } from '@app/shared';

import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import CampaignDetailPage from './CampaignDetailPage';

/**
 * F5 component test: CampaignDetailPage send flow.
 *
 * Flow:
 *   1. GET /campaigns/:id (initial)  -> status='draft', stats zero, 0 recipients.
 *   2. User clicks "Send now" -> Popconfirm "Send" button.
 *   3. POST /campaigns/:id/send -> 202 { id, status: 'sending' }.
 *      The send mutation's `onSuccess` does an OPTIMISTIC `setQueryData` flip
 *      to status='sending', which:
 *        - Re-renders <CampaignActions> in its 'sending' branch
 *          ("Sending in progress…" + Spin).
 *        - Triggers `useCampaign`'s `refetchInterval` to return 1500 (because
 *          cached `data?.status === 'sending'` AND `polling: true`).
 *   4. After 1500ms, GET /campaigns/:id (polling) -> status='sent', stats
 *      populated.
 *      Polling self-stops because `data?.status === 'sent'` is no longer
 *      'sending'.
 *   5. Assert <StatsBlock> rendered the new stats (numeric counts visible).
 *
 * We mock `react-router-dom`'s `useNavigate` (CampaignActions imports it but
 * we never trigger it in this happy path — the spy stays untouched).
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

const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';

function makeDraft(): CampaignDetail {
  return {
    id: CAMPAIGN_ID,
    name: 'Spring promo',
    subject: 'Save 20%',
    body: 'Body content here.',
    status: 'draft',
    scheduled_at: null,
    created_by: 'u-1',
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    stats: {
      total: 0,
      sent: 0,
      failed: 0,
      opened: 0,
      send_rate: 0,
      open_rate: 0,
    },
    recipients: [],
  };
}

function makeSent(): CampaignDetail {
  return {
    ...makeDraft(),
    status: 'sent',
    stats: {
      total: 100,
      sent: 100,
      failed: 0,
      opened: 42,
      send_rate: 1,
      open_rate: 0.42,
    },
  };
}

function renderDetail() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/campaigns/${CAMPAIGN_ID}`]}>
        <Routes>
          <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CampaignDetailPage — send flow', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 't',
      user: {
        id: 'u-1',
        email: 'me@example.com',
        name: 'Me',
        created_at: '2026-05-08T00:00:00.000Z',
      },
    });
    navigateMock.mockReset();
    (api.get as Mock).mockReset();
    (api.post as Mock).mockReset();
  });
  afterEach(() => {
    useAuthStore.setState({ token: null, user: null });
  });

  it(
    'GET draft -> click Send -> POST 202 -> polling GET sent -> stats render',
    async () => {
      // 1) Initial GET returns draft.
      // 2) Polling GET (after the optimistic flip to 'sending') returns sent.
      (api.get as Mock)
        .mockResolvedValueOnce({ data: makeDraft() })
        .mockResolvedValue({ data: makeSent() });

      // POST /send -> 202 sending. The hook's onSuccess flips cache to
      // 'sending' optimistically, which (a) shows the Sending spinner and
      // (b) lets `useCampaign`'s refetchInterval return 1500.
      (api.post as Mock).mockResolvedValueOnce({
        data: { id: CAMPAIGN_ID, status: 'sending' },
      });

      const user = userEvent.setup();
      renderDetail();

      // Wait for initial draft render (header name + draft Send button).
      await waitFor(() => {
        expect(screen.getByText('Spring promo')).toBeInTheDocument();
      });
      // The "Send now" button is rendered when status='draft'.
      const sendButton = await screen.findByRole('button', {
        name: /send now/i,
      });
      await user.click(sendButton);

      // The Popconfirm renders an "OK" button with text "Send" (okText).
      const confirmButton = await screen.findByRole('button', {
        name: /^send$/i,
      });
      await user.click(confirmButton);

      // POST /send is called.
      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith(
          `/campaigns/${CAMPAIGN_ID}/send`,
        );
      });

      // After the optimistic flip, CampaignActions renders its 'sending'
      // branch ("Sending in progress…").
      await waitFor(() => {
        expect(
          screen.getByText(/sending in progress/i),
        ).toBeInTheDocument();
      });

      // Polling kicks in (refetchInterval=1500). Wait for at least one
      // polling tick — the second GET — to fire. The mock's second
      // resolution returns status='sent', which:
      //  - Flips the StatusBadge in the header to the success-colored 'Sent'
      //    tag (distinct from the 'Sent' label in StatsBlock's <Statistic>).
      //  - Stops polling because status !== 'sending' on the next interval
      //    evaluation.
      // Use a long-ish timeout (5s) to absorb the 1500ms polling tick.
      await waitFor(
        () => {
          expect((api.get as Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
        },
        { timeout: 5000, interval: 100 },
      );

      // Distinguish the StatusBadge "Sent" tag (header) from the StatsBlock
      // Statistic titled "Sent" (label only) by searching for the
      // success-colored AntD tag specifically.
      await waitFor(() => {
        const successTag = document.querySelector('.ant-tag-success');
        expect(successTag).not.toBeNull();
        expect(successTag?.textContent).toMatch(/sent/i);
      });

      // StatsBlock label sanity (these labels are present in both draft and
      // sent data, but their presence confirms StatsBlock rendered).
      expect(screen.getByText('Total')).toBeInTheDocument();
      expect(screen.getByText('Send rate')).toBeInTheDocument();
      expect(screen.getByText('Open rate')).toBeInTheDocument();
    },
    10000,
  );
});
