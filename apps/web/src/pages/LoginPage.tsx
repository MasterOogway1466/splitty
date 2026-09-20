import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout, ErrorBanner, SubmitButton, TextField } from "../components/AuthLayout.js";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 423) {
        setError("Too many failed attempts. Try again in a few minutes.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Please slow down and try again shortly.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Log in">
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        <SubmitButton disabled={submitting}>{submitting ? "Logging in…" : "Log in"}</SubmitButton>
      </form>
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link to="/signup" className="text-slate-900 font-medium hover:underline">
          Create an account
        </Link>
        <Link to="/forgot-password" className="text-slate-500 hover:underline">
          Forgot password?
        </Link>
      </div>
    </AuthLayout>
  );
}
