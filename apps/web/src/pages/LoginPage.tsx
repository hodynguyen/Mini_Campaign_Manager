import { Button, Card, Form, Input, Typography } from 'antd';
import axios from 'axios';
import { Link } from 'react-router-dom';

import ErrorAlert from '../components/ErrorAlert';
import { useLoginMutation } from '../hooks/useAuth';
import { isApiErrorResponse } from '../types/api-error';

/**
 * F5 — `/login` page.
 *
 * AntD Form (vertical) with email + password. Submit calls
 * `useLoginMutation()`; the hook stores auth + navigates on success.
 *
 * Errors: any axios failure flows into `<ErrorAlert>`. The component pulls
 * `code` + `message` straight off the API envelope so display goes through
 * `messageFor(code, fallback)` — never `error.message`.
 */
interface LoginFormValues {
  email: string;
  password: string;
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

export default function LoginPage(): JSX.Element {
  const mutation = useLoginMutation();
  const errProps = mutation.error ? extractApiError(mutation.error) : null;

  const onFinish = (values: LoginFormValues) => {
    mutation.mutate(values);
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        padding: 24,
        background: '#f5f5f5',
      }}
    >
      <Card style={{ width: 400, maxWidth: '100%' }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Sign in
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Welcome back. Enter your credentials to continue.
        </Typography.Paragraph>

        {errProps ? (
          <div style={{ marginBottom: 16 }}>
            <ErrorAlert {...alertProps(errProps)} />
          </div>
        ) : null}

        <Form<LoginFormValues>
          layout="vertical"
          onFinish={onFinish}
          autoComplete="on"
          requiredMark={false}
        >
          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: true, message: 'Email is required' },
              { type: 'email', message: 'Enter a valid email' },
            ]}
          >
            <Input type="email" autoComplete="email" placeholder="you@example.com" />
          </Form.Item>

          <Form.Item
            label="Password"
            name="password"
            rules={[
              { required: true, message: 'Password is required' },
              { min: 8, message: 'Password must be at least 8 characters' },
            ]}
          >
            <Input.Password autoComplete="current-password" placeholder="••••••••" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={mutation.isPending}
              block
            >
              Sign in
            </Button>
          </Form.Item>
        </Form>

        <Typography.Paragraph style={{ marginBottom: 0, textAlign: 'center' }}>
          Don&apos;t have an account? <Link to="/register">Register</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
