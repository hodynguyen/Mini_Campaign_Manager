import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Layout, Space, Typography } from 'antd';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';

import ErrorAlert from '../components/ErrorAlert';
import { useCreateCampaignMutation } from '../hooks/useCampaigns';
import { isApiErrorResponse } from '../types/api-error';

interface CampaignFormValues {
  name: string;
  subject: string;
  body: string;
  recipient_emails?: string;
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
 * Parse the recipient_emails textarea into a deduped list.
 *
 * Rules (architect lock):
 *  - split on `[,\n]`
 *  - trim each entry
 *  - drop empties
 *  - lowercase
 *  - dedupe via Set (preserves first occurrence order)
 *
 * Server validates email shape via zod — surface VALIDATION_ERROR via
 * `messageFor` if anything malformed slips through.
 */
function parseRecipientEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const v = part.trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export default function CampaignNewPage(): JSX.Element {
  const navigate = useNavigate();
  const mutation = useCreateCampaignMutation();
  const errProps = mutation.error ? extractApiError(mutation.error) : null;

  const onFinish = (values: CampaignFormValues) => {
    const recipients = parseRecipientEmails(values.recipient_emails);
    const payload: {
      name: string;
      subject: string;
      body: string;
      recipient_emails?: string[];
    } = {
      name: values.name.trim(),
      subject: values.subject.trim(),
      body: values.body,
    };
    if (recipients.length > 0) payload.recipient_emails = recipients;

    mutation.mutate(payload, {
      onSuccess: (created) => {
        navigate(`/campaigns/${created.id}`, { replace: true });
      },
    });
  };

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
        <Card style={{ maxWidth: 800, margin: '0 auto' }}>
          <Typography.Title level={3} style={{ marginTop: 0 }}>
            New campaign
          </Typography.Title>

          {errProps ? (
            <div style={{ marginBottom: 16 }}>
              <ErrorAlert {...alertProps(errProps)} />
            </div>
          ) : null}

          <Form<CampaignFormValues>
            layout="vertical"
            onFinish={onFinish}
            requiredMark={false}
          >
            <Form.Item
              label="Name"
              name="name"
              rules={[
                { required: true, message: 'Name is required' },
                { max: 200, message: 'Name must be 200 characters or fewer' },
              ]}
            >
              <Input placeholder="Spring sale announcement" />
            </Form.Item>

            <Form.Item
              label="Subject"
              name="subject"
              rules={[
                { required: true, message: 'Subject is required' },
                { max: 300, message: 'Subject must be 300 characters or fewer' },
              ]}
            >
              <Input placeholder="A new offer just for you" />
            </Form.Item>

            <Form.Item
              label="Body"
              name="body"
              rules={[
                { required: true, message: 'Body is required' },
                { max: 10000, message: 'Body must be 10,000 characters or fewer' },
              ]}
            >
              <Input.TextArea rows={8} placeholder="Write the email content here…" />
            </Form.Item>

            <Form.Item
              label="Recipient emails"
              name="recipient_emails"
              extra="Optional. Separate multiple emails with commas or new lines."
            >
              <Input.TextArea
                rows={4}
                placeholder="alice@example.com, bob@example.com"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={mutation.isPending}
                >
                  Create campaign
                </Button>
                <Button onClick={() => navigate('/campaigns')}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>
      </Layout.Content>
    </Layout>
  );
}
