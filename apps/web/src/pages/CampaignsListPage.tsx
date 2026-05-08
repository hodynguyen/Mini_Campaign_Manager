import { PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Empty,
  Layout,
  Select,
  Skeleton,
  Space,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import axios from 'axios';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import ErrorAlert from '../components/ErrorAlert';
import StatusBadge from '../components/StatusBadge';
import { useLogout } from '../hooks/useAuth';
import { useCampaignsList } from '../hooks/useCampaigns';
import { isApiErrorResponse } from '../types/api-error';
import type { Campaign, CampaignStatus } from '@app/shared';

const PAGE_SIZE = 20;

const STATUS_FILTERS: { label: string; value: CampaignStatus | '' }[] = [
  { label: 'All statuses', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Sending', value: 'sending' },
  { label: 'Sent', value: 'sent' },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function extractApiError(err: unknown): { code?: string; fallback?: string } {
  if (axios.isAxiosError(err) && isApiErrorResponse(err.response?.data)) {
    const e = err.response.data.error;
    return { code: e.code, fallback: e.message };
  }
  if (err instanceof Error) return { fallback: err.message };
  return {};
}

function alertProps(e: { code?: string; fallback?: string }): {
  code?: string;
  fallback?: string;
} {
  const out: { code?: string; fallback?: string } = {};
  if (e.code !== undefined) out.code = e.code;
  if (e.fallback !== undefined) out.fallback = e.fallback;
  return out;
}

/**
 * F5 — `/campaigns` list page.
 *
 * URL search params drive page + status so back/forward preserves position.
 * `useCampaignsList({ page, limit, status })` matches the locked queryKey.
 */
export default function CampaignsListPage(): JSX.Element {
  const navigate = useNavigate();
  const logout = useLogout();
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get('page') ?? '1'));
  const statusParam = (params.get('status') ?? '') as CampaignStatus | '';
  const listQuery: { page: number; limit: number; status?: CampaignStatus } = {
    page,
    limit: PAGE_SIZE,
  };
  if (statusParam !== '') listQuery.status = statusParam;

  const query = useCampaignsList(listQuery);

  const columns: ColumnsType<Campaign> = useMemo(
    () => [
      {
        title: 'Name',
        dataIndex: 'name',
        key: 'name',
        render: (name: string, row) => (
          <Link to={`/campaigns/${row.id}`}>{name}</Link>
        ),
      },
      {
        title: 'Subject',
        dataIndex: 'subject',
        key: 'subject',
        ellipsis: true,
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (s: CampaignStatus) => <StatusBadge status={s} />,
        width: 140,
      },
      {
        title: 'Updated',
        dataIndex: 'updated_at',
        key: 'updated_at',
        render: (iso: string) => formatDate(iso),
        width: 200,
      },
    ],
    [],
  );

  const errProps = query.error ? extractApiError(query.error) : null;

  const onPaginationChange = (nextPage: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(nextPage));
    setParams(next, { replace: false });
  };

  const onStatusChange = (value: CampaignStatus | '') => {
    const next = new URLSearchParams(params);
    if (value) next.set('status', value);
    else next.delete('status');
    next.set('page', '1');
    setParams(next, { replace: false });
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Layout.Header
        style={{
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          paddingInline: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          Campaigns
        </Typography.Title>
        <Space>
          <Button onClick={logout}>Log out</Button>
        </Space>
      </Layout.Header>

      <Layout.Content style={{ padding: 24 }}>
        <Card>
          <Space
            style={{
              width: '100%',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
            wrap
          >
            <Select
              value={statusParam}
              onChange={onStatusChange}
              style={{ width: 200 }}
              options={STATUS_FILTERS}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/campaigns/new')}
            >
              New campaign
            </Button>
          </Space>

          {errProps ? (
            <div style={{ marginBottom: 16 }}>
              <ErrorAlert {...alertProps(errProps)} />
            </div>
          ) : null}

          {query.isLoading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : query.data && query.data.data.length === 0 ? (
            <Empty
              description="No campaigns yet"
              style={{ padding: '32px 0' }}
            >
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate('/campaigns/new')}
              >
                Create your first campaign
              </Button>
            </Empty>
          ) : (
            <Table<Campaign>
              rowKey="id"
              columns={columns}
              dataSource={query.data?.data ?? []}
              loading={query.isFetching && !query.isLoading}
              pagination={{
                current: query.data?.meta.page ?? page,
                pageSize: query.data?.meta.limit ?? PAGE_SIZE,
                total: query.data?.meta.total ?? 0,
                showSizeChanger: false,
                onChange: onPaginationChange,
              }}
            />
          )}
        </Card>
      </Layout.Content>
    </Layout>
  );
}
