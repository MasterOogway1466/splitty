import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout, ErrorBanner, SuccessBanner } from "../components/AuthLayout.js";
import { apiPost, ApiError } from "../lib/api.js";

type Status = "verifying" | "success" | "error";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Missing verification token.");
      return;
    }
    apiPost("/auth/verify-email", { token })
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus("error");
        setError(err instanceof ApiError ? err.message : "Verification failed.");
      });
  }, [token]);

  return (
    <AuthLayout title="Verify your email">
      {status === "verifying" && <p className="text-sm text-ink-muted">Verifying…</p>}
      {status === "success" && (
        <>
          <SuccessBanner message="Your email is verified." />
          <Link to="/login" className="text-sm text-ledger font-medium hover:underline">
            Continue to log in
          </Link>
        </>
      )}
      {status === "error" && error && <ErrorBanner message={error} />}
    </AuthLayout>
  );
}
