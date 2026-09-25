import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AuthLayout, SubmitButton, SuccessBanner, TextField } from "../components/AuthLayout.js";
import { apiPost } from "../lib/api.js";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    // Always shows the same generic confirmation, whether or not the
    // email is registered — the API itself never reveals that (§5).
    await apiPost("/auth/request-password-reset", { email }).catch(() => {});
    setSubmitting(false);
    setDone(true);
  }

  return (
    <AuthLayout title="Reset your password">
      {done ? (
        <SuccessBanner message="If an account with that email exists, a reset link was sent." />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
          <SubmitButton disabled={submitting}>{submitting ? "Sending…" : "Send reset link"}</SubmitButton>
        </form>
      )}
      <p className="mt-4 text-sm text-center">
        <Link to="/login" className="text-ledger font-medium hover:underline">
          Back to login
        </Link>
      </p>
    </AuthLayout>
  );
}
