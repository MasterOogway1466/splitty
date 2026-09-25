import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout, ErrorBanner, SubmitButton, SuccessBanner, TextField } from "../components/AuthLayout.js";
import { apiPost, ApiError } from "../lib/api.js";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("Missing reset token.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/auth/confirm-password-reset", { token, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Set a new password">
      {done ? (
        <>
          <SuccessBanner message="Password updated. You've been logged out everywhere — log in with your new password." />
          <Link to="/login" className="text-sm text-ledger font-medium hover:underline">
            Continue to log in
          </Link>
        </>
      ) : (
        <>
          {error && <ErrorBanner message={error} />}
          <form onSubmit={handleSubmit} className="space-y-4">
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              required
              minLength={8}
            />
            <SubmitButton disabled={submitting}>{submitting ? "Updating…" : "Update password"}</SubmitButton>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
