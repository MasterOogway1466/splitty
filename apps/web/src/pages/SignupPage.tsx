import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout, ErrorBanner, SubmitButton, TextField } from "../components/AuthLayout.js";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState({ password: false, confirmPassword: false });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Only once both fields have been visited, so nobody is corrected while
  // still typing for the first time; after that it follows every keystroke.
  const mismatch = password !== confirmPassword;
  const showMismatch = mismatch && touched.password && touched.confirmPassword && password !== "" && confirmPassword !== "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mismatch) {
      setTouched({ password: true, confirmPassword: true });
      return;
    }
    setSubmitting(true);
    try {
      await signup(email, password, displayName);
      navigate("/check-your-email", { state: { email } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Create your account">
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField label="Name" value={displayName} onChange={setDisplayName} autoComplete="name" required />
        <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
          autoComplete="new-password"
          required
          minLength={8}
        />
        <TextField
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          onBlur={() => setTouched((prev) => ({ ...prev, confirmPassword: true }))}
          error={showMismatch ? "The passwords don't match." : null}
          autoComplete="new-password"
          required
          minLength={8}
        />
        <SubmitButton disabled={submitting}>{submitting ? "Creating account…" : "Sign up"}</SubmitButton>
      </form>
      <p className="mt-4 text-sm text-ink-muted text-center">
        Already have an account?{" "}
        <Link to="/login" className="text-ledger font-medium hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
