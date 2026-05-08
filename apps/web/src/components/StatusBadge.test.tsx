import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CampaignStatus } from '@app/shared';

import StatusBadge from './StatusBadge';

/**
 * F5 component test: StatusBadge — covers the 4-status color/label map locked
 * in spec §UX requirements. The locked map (also in StatusBadge.tsx):
 *   draft     -> default      'Draft'
 *   scheduled -> processing   'Scheduled'
 *   sending   -> warning      'Sending…'
 *   sent      -> success      'Sent'
 *
 * AntD v5 renders `<Tag color="...">` with className `ant-tag-<color>` for
 * the four named status colors above. Asserting on the className keeps the
 * test resilient to the inner DOM structure of `<Tag>` while still locking
 * the color contract.
 */
describe('StatusBadge', () => {
  const cases: Array<{ status: CampaignStatus; label: string; color: string }> = [
    { status: 'draft', label: 'Draft', color: 'default' },
    { status: 'scheduled', label: 'Scheduled', color: 'processing' },
    { status: 'sending', label: 'Sending…', color: 'warning' },
    { status: 'sent', label: 'Sent', color: 'success' },
  ];

  it.each(cases)(
    'renders $label with the $color tag for status=$status',
    ({ status, label, color }) => {
      const { container } = render(<StatusBadge status={status} />);
      // Label assertion: the locked human-readable label per status.
      expect(screen.getByText(label)).toBeInTheDocument();
      // Color assertion: AntD v5 emits `ant-tag-<color>` for named colors.
      const tag = container.querySelector('.ant-tag');
      expect(tag).not.toBeNull();
      expect(tag?.className).toContain(`ant-tag-${color}`);
    },
  );
});
