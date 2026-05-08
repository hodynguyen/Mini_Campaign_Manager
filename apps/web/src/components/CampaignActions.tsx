import {
  CalendarOutlined,
  DeleteOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  DatePicker,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
  notification,
} from 'antd';
import axios from 'axios';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { CampaignDetail } from '@app/shared';

import {
  useDeleteCampaignMutation,
  useScheduleCampaignMutation,
  useSendCampaignMutation,
} from '../hooks/useCampaigns';
import { isApiErrorResponse, messageFor } from '../types/api-error';

/**
 * F5 — Conditional campaign action row.
 *
 * Buttons rendered per `business-rules.md` state machine:
 *   draft     -> [Schedule] [Send] [Delete]
 *   scheduled -> [Send] (+ display scheduled_at)
 *   sending   -> Spin "Sending in progress…"
 *   sent      -> "Already sent" tag.
 *
 * Mutation error UX: ALL error messages flow through `messageFor(code,
 * fallback)` — never `error.message`.
 */
export interface CampaignActionsProps {
  campaign: CampaignDetail;
}

function showApiError(err: unknown, fallbackTitle: string): void {
  let code: string | undefined;
  let fallback: string | undefined;
  if (axios.isAxiosError(err) && isApiErrorResponse(err.response?.data)) {
    code = err.response.data.error.code;
    fallback = err.response.data.error.message;
  } else if (err instanceof Error) {
    fallback = err.message;
  }
  notification.error({
    message: fallbackTitle,
    description: messageFor(code, fallback),
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function CampaignActions({
  campaign,
}: CampaignActionsProps): JSX.Element {
  const navigate = useNavigate();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState<Dayjs | null>(null);

  const scheduleMutation = useScheduleCampaignMutation();
  const sendMutation = useSendCampaignMutation();
  const deleteMutation = useDeleteCampaignMutation();

  const onSchedule = () => {
    if (!scheduleValue) return;
    scheduleMutation.mutate(
      { id: campaign.id, scheduled_at: scheduleValue.toISOString() },
      {
        onSuccess: () => {
          setScheduleOpen(false);
          setScheduleValue(null);
          notification.success({ message: 'Campaign scheduled' });
        },
        onError: (err) => showApiError(err, 'Could not schedule campaign'),
      },
    );
  };

  const onSend = () => {
    sendMutation.mutate(
      { id: campaign.id },
      {
        onSuccess: () => {
          notification.success({ message: 'Send started' });
        },
        onError: (err) => showApiError(err, 'Could not send campaign'),
      },
    );
  };

  const onDelete = () => {
    deleteMutation.mutate(
      { id: campaign.id },
      {
        onSuccess: () => {
          notification.success({ message: 'Campaign deleted' });
          navigate('/campaigns', { replace: true });
        },
        onError: (err) => showApiError(err, 'Could not delete campaign'),
      },
    );
  };

  return (
    <Card title="Actions" style={{ marginTop: 16 }}>
      {campaign.status === 'draft' && (
        <Space wrap>
          <Button
            icon={<CalendarOutlined />}
            onClick={() => setScheduleOpen(true)}
          >
            Schedule
          </Button>

          <Popconfirm
            title="Send to all recipients now?"
            description="This kicks off the send job immediately."
            okText="Send"
            cancelText="Cancel"
            onConfirm={onSend}
          >
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={sendMutation.isPending}
            >
              Send now
            </Button>
          </Popconfirm>

          <Popconfirm
            title="Delete this draft?"
            description="This cannot be undone."
            okText="Delete"
            okType="danger"
            cancelText="Cancel"
            onConfirm={onDelete}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </Popconfirm>
        </Space>
      )}

      {campaign.status === 'scheduled' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            Scheduled for <strong>{formatDate(campaign.scheduled_at)}</strong>
          </Typography.Text>
          <Popconfirm
            title="Send to all recipients now?"
            description="This bypasses the scheduled time and sends immediately."
            okText="Send"
            cancelText="Cancel"
            onConfirm={onSend}
          >
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={sendMutation.isPending}
            >
              Send now
            </Button>
          </Popconfirm>
        </Space>
      )}

      {campaign.status === 'sending' && (
        <Space>
          <Spin />
          <Typography.Text type="secondary">
            Sending in progress…
          </Typography.Text>
        </Space>
      )}

      {campaign.status === 'sent' && <Tag color="success">Already sent</Tag>}

      <Modal
        title="Schedule campaign"
        open={scheduleOpen}
        onCancel={() => {
          setScheduleOpen(false);
          setScheduleValue(null);
        }}
        onOk={onSchedule}
        okText="Schedule"
        okButtonProps={{
          loading: scheduleMutation.isPending,
          disabled: !scheduleValue,
        }}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          Pick a future date and time. The send worker will pick it up at that
          time.
        </Typography.Paragraph>
        <DatePicker
          showTime
          style={{ width: '100%' }}
          value={scheduleValue}
          onChange={(v) => setScheduleValue(v)}
          disabledDate={(d) => d.isBefore(dayjs(), 'minute')}
          placeholder="Select date and time"
        />
      </Modal>
    </Card>
  );
}
