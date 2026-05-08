import { Card, Empty, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import type { CampaignRecipientRow, CampaignRecipientStatus } from '@app/shared';

/**
 * F5 — Recipients table.
 *
 * Sortable AntD `<Table>` with columns: email, name, status, sent_at, opened_at.
 *
 * Status color map (mirrors the per-recipient enum):
 *   pending -> default
 *   sent    -> success
 *   failed  -> error
 *
 * Date formatting via `toLocaleString()`; null -> '—' for sent_at and
 * "Not opened" for opened_at (clearer affordance than '—' on the open column).
 */
export interface RecipientsTableProps {
  rows: CampaignRecipientRow[];
}

const STATUS_COLOR: Record<CampaignRecipientStatus, string> = {
  pending: 'default',
  sent: 'success',
  failed: 'error',
};

const STATUS_LABEL: Record<CampaignRecipientStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const columns: ColumnsType<CampaignRecipientRow> = [
  {
    title: 'Email',
    dataIndex: 'email',
    key: 'email',
    sorter: (a, b) => a.email.localeCompare(b.email),
  },
  {
    title: 'Name',
    dataIndex: 'name',
    key: 'name',
    sorter: (a, b) => a.name.localeCompare(b.name),
  },
  {
    title: 'Status',
    dataIndex: 'status',
    key: 'status',
    width: 120,
    render: (s: CampaignRecipientStatus) => (
      <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>
    ),
    sorter: (a, b) => a.status.localeCompare(b.status),
    filters: [
      { text: 'Pending', value: 'pending' },
      { text: 'Sent', value: 'sent' },
      { text: 'Failed', value: 'failed' },
    ],
    onFilter: (value, record) => record.status === value,
  },
  {
    title: 'Sent at',
    dataIndex: 'sent_at',
    key: 'sent_at',
    width: 200,
    render: (iso: string | null) => formatDate(iso),
    sorter: (a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''),
  },
  {
    title: 'Opened at',
    dataIndex: 'opened_at',
    key: 'opened_at',
    width: 200,
    render: (iso: string | null) =>
      iso ? new Date(iso).toLocaleString() : 'Not opened',
    sorter: (a, b) => (a.opened_at ?? '').localeCompare(b.opened_at ?? ''),
  },
];

export default function RecipientsTable({ rows }: RecipientsTableProps): JSX.Element {
  return (
    <Card title="Recipients" style={{ marginTop: 16 }}>
      {rows.length === 0 ? (
        <Empty description="No recipients attached to this campaign." />
      ) : (
        <Table<CampaignRecipientRow>
          rowKey="recipient_id"
          columns={columns}
          dataSource={rows}
          size="middle"
          pagination={{ pageSize: 25, showSizeChanger: false }}
        />
      )}
    </Card>
  );
}
