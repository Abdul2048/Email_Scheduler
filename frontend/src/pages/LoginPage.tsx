import { Navigate, useSearchParams } from 'react-router-dom';
import { GOOGLE_LOGIN_URL } from '../api/auth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { GoogleIcon } from '../features/auth/GoogleIcon';
import { useMe } from '../features/auth/useMe';

const ERRORS: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled.',
  invalid_state: 'Your sign-in session expired. Please try again.',
  missing_profile: "Google didn't share your email address.",
  oauth_failed: "Couldn't complete Google sign-in. Please try again.",
};

export function LoginPage() {
  const [params] = useSearchParams();
  const { data: user } = useMe();
  const error = params.get('error');

  if (user) return <Navigate to="/scheduled" replace />;

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-[350px] rounded-xl border border-line px-10 pt-10 pb-9">
        <h1 className="mb-6 text-center text-[26px] font-semibold">Login</h1>

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-center text-danger">
            {ERRORS[error] ?? `Sign-in failed (${error}).`}
          </p>
        )}

        <a
          href={GOOGLE_LOGIN_URL}
          className="flex h-[34px] items-center justify-center gap-2 rounded-lg bg-brand-soft text-[13px] font-medium transition-colors hover:bg-brand-border/60"
        >
          <GoogleIcon className="size-4" />
          Login with Google
        </a>

        <div className="my-5 flex items-center gap-3 text-xs text-subtle">
          <span className="h-px flex-1 bg-line" />
          or sign up through email
          <span className="h-px flex-1 bg-line" />
        </div>

        <form className="space-y-2.5" onSubmit={(e) => e.preventDefault()} title="Use Login with Google">
          <Input type="email" placeholder="Email ID" disabled aria-label="Email ID" />
          <Input type="password" placeholder="Password" disabled aria-label="Password" />
          <Button type="submit" disabled className="!mt-5 w-full">
            Login
          </Button>
        </form>
        <p className="mt-3 text-center text-xs text-muted">Email sign-in isn't available in this demo. Use Google.</p>
      </div>
    </div>
  );
}
