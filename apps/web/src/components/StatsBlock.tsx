import { Card, Col, Progress, Row, Statistic } from 'antd';

import type { CampaignStats } from '@app/shared';

/**
 * F5 — Campaign stats block.
 *
 * Layout:
 *  - 4 `<Statistic>`: total, sent, failed, opened.
 *  - 2 `<Progress>` bars: send_rate + open_rate (rendered as %).
 *
 * Frontend MUST display server-supplied rates as-is (no client recompute).
 * Server contract per `business-rules.md`:
 *   send_rate = sent / total (0 when total = 0)
 *   open_rate = opened / sent (0 when sent  = 0)
 */
export interface StatsBlockProps {
  stats: CampaignStats;
}

function pct(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.round(rate * 100);
}

export default function StatsBlock({ stats }: StatsBlockProps): JSX.Element {
  return (
    <Card title="Stats" style={{ marginTop: 16 }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <Statistic title="Total" value={stats.total} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Sent" value={stats.sent} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Failed" value={stats.failed} />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic title="Opened" value={stats.opened} />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} sm={12}>
          <div style={{ marginBottom: 8 }}>Send rate</div>
          <Progress
            percent={pct(stats.send_rate)}
            status={stats.send_rate >= 1 ? 'success' : 'active'}
          />
        </Col>
        <Col xs={24} sm={12}>
          <div style={{ marginBottom: 8 }}>Open rate</div>
          <Progress percent={pct(stats.open_rate)} status="normal" />
        </Col>
      </Row>
    </Card>
  );
}
