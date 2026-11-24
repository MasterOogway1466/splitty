import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { UserProfile } from "@splitty/shared";
import { AuthLayout, ErrorBanner, SubmitButton, TextField } from "../components/AuthLayout.js";
import { apiFetchOnce, ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = (await apiFetchOnce("/auth/verify-email", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      })) as { accessToken: string; user: UserProfile };
      setSession(body.accessToken, body.user);
      navigate("/");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "invalid_credentials"
          ? "That isn't the password this account was created with."
          : err instanceof ApiError
            ? err.message
            : "Verification failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Verify your email">
        <ErrorBanner message="Missing verification token." />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Verify your email">
      <p className="text-sm text-ink-muted mb-4">Enter the password you signed up with to finish.</p>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        <SubmitButton disabled={submitting}>{submitting ? "Verifying…" : "Verify email"}</SubmitButton>
      </form>
      <p className="mt-4 text-sm text-ink-muted">
        Didn't sign up, or forgot it?{" "}
        <Link to="/forgot-password" className="text-ledger font-medium hover:underline">
          Reset the password
        </Link>
      </p>
    </AuthLayout>
  );
}
