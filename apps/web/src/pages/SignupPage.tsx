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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
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
        <SubmitButton disabled={submitting}>{submitting ? "Creating account…" : "Sign up"}</SubmitButton>
      </form>
      <p className="mt-4 text-sm text-slate-600 text-center">
        Already have an account?{" "}
        <Link to="/login" className="text-slate-900 font-medium hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
