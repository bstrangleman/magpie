import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import type { Me } from '../../../shared/types.ts';
import { Logo } from '../components/common.tsx';
import { Button, ErrorText, Field, Input, Spinner } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { qk, useAuthStatus } from '../lib/queries.ts';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { data: status, isLoading } = useAuthStatus();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/all';

  if (isLoading || !status) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!status.hasUsers && mode === 'login') return <Navigate to={`/signup${params.size ? `?${params}` : ''}`} replace />;
  if (!status.signupsEnabled && mode === 'signup') return <Navigate to="/login" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const me = await api.post<Me>(mode === 'login' ? '/auth/login' : '/auth/signup', { name, email, password });
      qc.setQueryData(qk.me, me);
      qc.invalidateQueries({ queryKey: qk.status });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const firstRun = mode === 'signup' && !status.hasUsers;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={44} />
          <h1 className="text-xl font-semibold">{mode === 'login' ? 'Sign in to Magpie' : firstRun ? 'Set up Magpie' : 'Create your account'}</h1>
          {firstRun && <p className="text-sm text-ink-2">Create the first account. It will be the administrator.</p>}
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-sm">
          {mode === 'signup' && (
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus={mode === 'login'} />
          </Field>
          <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              required
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button variant="primary" type="submit" loading={busy} className="mt-2 w-full">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        {status.hasUsers && status.signupsEnabled && (
          <p className="mt-4 text-center text-sm text-ink-2">
            {mode === 'login' ? (
              <>
                New here?{' '}
                <Link to="/signup" className="font-medium text-accent hover:underline">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Have an account?{' '}
                <Link to="/login" className="font-medium text-accent hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
