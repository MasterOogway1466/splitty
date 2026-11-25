import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { textLinkClass } from "../components/styles.js";
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("The passwords don't match.");
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
          autoComplete="new-password"
          required
          minLength={8}
        />
        <TextField
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
          required
          minLength={8}
        />
        <SubmitButton disabled={submitting}>{submitting ? "Creating account…" : "Sign up"}</SubmitButton>
      </form>
      <p className="mt-4 text-sm text-ink-muted text-center">
        Already have an account?{" "}
        <Link to="/login" className={textLinkClass}>
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
