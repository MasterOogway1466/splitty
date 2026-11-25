import { useState } from "react";
import { ApiError, apiPost } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { AppShell } from "./AppShell.js";
import { Button } from "./Button.js";
import { ErrorBanner, SuccessBanner } from "./AuthLayout.js";

/** Shown in place of any page that needs a verified address. */
export function VerifyEmailNotice() {
  const { user, refreshUser } = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setMessage(null);
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "rate_limited"
          ? "You've asked for several emails already. Try again in an hour."
          : err instanceof ApiError
            ? err.message
            : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  const resend = () =>
    run(async () => {
      await apiPost("/auth/resend-verification");
      setMessage(`Sent a new link to ${user?.email}.`);
    });
  const recheck = () =>
    run(async () => {
      const profile = await refreshUser();
      if (!profile.emailVerified) setError("Not verified yet. Open the link in the email first.");
    });

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-ink mb-2">Verify your email</h1>
      <p className="text-sm text-ink-muted mb-4">
        We sent a link to {user?.email}. Open it to start using groups and expenses.
      </p>
      {message && <SuccessBanner message={message} />}
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="md" onClick={recheck} disabled={busy}>
          I've verified
        </Button>
        <Button size="md" icon="mail" onClick={resend} disabled={busy}>
          Resend email
        </Button>
      </div>
    </AppShell>
  );
}
