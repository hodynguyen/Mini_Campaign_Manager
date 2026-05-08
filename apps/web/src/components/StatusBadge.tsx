import { Tag } from 'antd';

import type { CampaignStatus } from '@app/shared';

/**
 * F5 — Campaign status badge.
 *
 * Color mapping is locked by spec §UX requirements:
 *   draft     -> default (grey)
 *   scheduled -> processing (blue, with the AntD pulsing dot)
 *   sending   -> warning (orange)
 *   sent      -> success (green)
 *
 * `processing` and `success` / `warning` are AntD v5 named tag colors —
 * `<Tag color="processing">` adds the animated dot; `<Tag color="success">`
 * gets the green check styling.
 */
export interface StatusBadgeProps {
  status: CampaignStatus;
}

const STATUS_MAP: Record<CampaignStatus, { color: string; label: string }> = {
  draft: { color: 'default', label: 'Draft' },
  scheduled: { color: 'processing', label: 'Scheduled' },
  sending: { color: 'warning', label: 'Sending…' },
  sent: { color: 'success', label: 'Sent' },
};

export default function StatusBadge({ status }: StatusBadgeProps): JSX.Element {
  const { color, label } = STATUS_MAP[status];
  return <Tag color={color}>{label}</Tag>;
}
