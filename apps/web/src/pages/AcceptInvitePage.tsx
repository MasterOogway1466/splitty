import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { UserProfile } from "@splitty/shared";
import { AuthLayout, ErrorBanner, SubmitButton, TextField } from "../components/AuthLayout.js";
import { ApiError, apiPost } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useInviteInfo } from "../lib/hooks.js";

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const infoQuery = useInviteInfo(token);

  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = (await apiPost(`/invites/${token}/accept`, { displayName, password })) as {
        accessToken: string;
        user: UserProfile;
      };
      setSession(body.accessToken, body.user);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Invite">
        <ErrorBanner message="Missing invite token." />
      </AuthLayout>
    );
  }

  if (infoQuery.isLoading) {
    return (
      <AuthLayout title="Invite">
        <p className="text-sm text-ink-muted">Loading…</p>
      </AuthLayout>
    );
  }

  if (infoQuery.isError) {
    return (
      <AuthLayout title="Invite">
        <ErrorBanner message="This invite link is invalid or has expired." />
      </AuthLayout>
    );
  }

  const info = infoQuery.data!;

  if (info.alreadyAccepted) {
    return (
      <AuthLayout title="Invite already used">
        <p className="text-sm text-ink-muted mb-4">This invite has already been claimed.</p>
        <Link to="/login" className="text-sm text-ledger font-medium hover:underline">
          Continue to log in
        </Link>
      </AuthLayout>
    );
  }

  if (info.expired) {
    return (
      <AuthLayout title="Invite expired">
        <p className="text-sm text-ink-muted">
          This invite link has expired. Ask {info.inviterDisplayName} to send you a new one.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="You're invited">
      <p className="text-sm text-ink-muted mb-4">
        {info.inviterDisplayName} invited you{info.groupName ? ` to join "${info.groupName}"` : ""} on Splitty
        ({info.inviteeEmail}). Set a display name and password to finish creating your account.
      </p>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField label="Your name" value={displayName} onChange={setDisplayName} required />
        <TextField label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" required minLength={8} />
        <SubmitButton disabled={submitting}>{submitting ? "Creating account…" : "Accept invite"}</SubmitButton>
      </form>
    </AuthLayout>
  );
}
