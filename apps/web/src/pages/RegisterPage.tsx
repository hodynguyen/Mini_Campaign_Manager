import { Button, Card, Form, Input, Typography } from 'antd';
import axios from 'axios';
import { Link } from 'react-router-dom';

import ErrorAlert from '../components/ErrorAlert';
import { useRegisterMutation } from '../hooks/useAuth';
import { isApiErrorResponse } from '../types/api-error';

/**
 * F5 — `/register` page.
 *
 * AntD Form (vertical) with name + email + password. Submit calls
 * `useRegisterMutation()`; that hook handles register + auto-login + redirect.
 *
 * Errors: 409 EMAIL_TAKEN / 400 VALIDATION_ERROR shown via `<ErrorAlert>`.
 */
interface RegisterFormValues {
  name: string;
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

export default function RegisterPage(): JSX.Element {
  const mutation = useRegisterMutation();
  const errProps = mutation.error ? extractApiError(mutation.error) : null;

  const onFinish = (values: RegisterFormValues) => {
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
          Create your account
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Sign up to start managing campaigns.
        </Typography.Paragraph>

        {errProps ? (
          <div style={{ marginBottom: 16 }}>
            <ErrorAlert {...alertProps(errProps)} />
          </div>
        ) : null}

        <Form<RegisterFormValues>
          layout="vertical"
          onFinish={onFinish}
          autoComplete="on"
          requiredMark={false}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[
              { required: true, message: 'Name is required' },
              { max: 120, message: 'Name is too long' },
            ]}
          >
            <Input autoComplete="name" placeholder="Jane Smith" />
          </Form.Item>

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
            hasFeedback
          >
            <Input.Password autoComplete="new-password" placeholder="••••••••" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={mutation.isPending}
              block
            >
              Create account
            </Button>
          </Form.Item>
        </Form>

        <Typography.Paragraph style={{ marginBottom: 0, textAlign: 'center' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
