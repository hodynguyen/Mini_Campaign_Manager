import { ArrowLeftOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Descriptions,
  Layout,
  Result,
  Skeleton,
  Space,
  Typography,
} from 'antd';
import axios from 'axios';
import { Link, useParams } from 'react-router-dom';

import CampaignActions from '../components/CampaignActions';
import ErrorAlert from '../components/ErrorAlert';
import RecipientsTable from '../components/RecipientsTable';
import StatsBlock from '../components/StatsBlock';
import StatusBadge from '../components/StatusBadge';
import { useCampaign } from '../hooks/useCampaigns';
import { isApiErrorResponse, messageFor } from '../types/api-error';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function extractApiError(err: unknown): {
  status?: number;
  code?: string;
  fallback?: string;
} {
  const out: { status?: number; code?: string; fallback?: string } = {};
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (status !== undefined) out.status = status;
    if (isApiErrorResponse(err.response?.data)) {
      const e = err.response.data.error;
      out.code = e.code;
      out.fallback = e.message;
    } else {
      out.fallback = err.message;
    }
    return out;
  }
  if (err instanceof Error) {
    out.fallback = err.message;
  }
  return out;
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
 * F5 — `/campaigns/:id` detail page.
 *
 * Polls every 1500ms only while `data.status === 'sending'` (architect lock —
 * the polling logic lives inside `useCampaign`).
 *
 * On 404 the page renders a friendly `<Result>` with a back link rather than
 * the generic `<ErrorAlert>` so the user has somewhere to go.
 */
export default function CampaignDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const query = useCampaign(id ?? '', { polling: true });

  if (query.isLoading) {
    return (
      <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <Layout.Content style={{ padding: 24 }}>
          <Card>
            <Skeleton active paragraph={{ rows: 8 }} />
          </Card>
        </Layout.Content>
      </Layout>
    );
  }

  if (query.error) {
    const e = extractApiError(query.error);
    if (e.status === 404 || e.code === 'CAMPAIGN_NOT_FOUND') {
      return (
        <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
          <Layout.Content style={{ padding: 24 }}>
            <Result
              status="404"
              title="Campaign not found"
              subTitle={messageFor(e.code, e.fallback)}
              extra={
                <Link to="/campaigns">
                  <Button type="primary">Back to campaigns</Button>
                </Link>
              }
            />
          </Layout.Content>
        </Layout>
      );
    }
    return (
      <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <Layout.Content style={{ padding: 24 }}>
          <ErrorAlert {...alertProps(e)} />
        </Layout.Content>
      </Layout>
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <Layout.Content style={{ padding: 24 }}>
          <Card>
            <Typography.Paragraph>No data available.</Typography.Paragraph>
          </Card>
        </Layout.Content>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Layout.Header
        style={{
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          paddingInline: 24,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Space>
          <Link to="/campaigns">
            <Button type="text" icon={<ArrowLeftOutlined />}>
              Back to campaigns
            </Button>
          </Link>
        </Space>
      </Layout.Header>

      <Layout.Content style={{ padding: 24 }}>
        <Card>
          <Space
            style={{ width: '100%', justifyContent: 'space-between' }}
            align="start"
            wrap
          >
            <div>
              <Typography.Title level={3} style={{ marginTop: 0 }}>
                {data.name}
              </Typography.Title>
              <StatusBadge status={data.status} />
            </div>
          </Space>

          <Descriptions column={{ xs: 1, sm: 2 }} style={{ marginTop: 16 }}>
            <Descriptions.Item label="Subject">{data.subject}</Descriptions.Item>
            <Descriptions.Item label="Created">
              {formatDate(data.created_at)}
            </Descriptions.Item>
            <Descriptions.Item label="Updated">
              {formatDate(data.updated_at)}
            </Descriptions.Item>
            <Descriptions.Item label="Scheduled">
              {formatDate(data.scheduled_at)}
            </Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="Body" style={{ marginTop: 16 }}>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
            {data.body}
          </Typography.Paragraph>
        </Card>

        <CampaignActions campaign={data} />
        <StatsBlock stats={data.stats} />
        <RecipientsTable rows={data.recipients} />
      </Layout.Content>
    </Layout>
  );
}
