import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CURRENCY_CODES, formatDate } from "@splitty/shared";
import { AppShell } from "../components/AppShell.js";
import { ErrorBanner, SubmitButton, SuccessBanner, TextField } from "../components/AuthLayout.js";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/AuthContext.js";
import { useUpdateProfile } from "../lib/hooks.js";

// The full IANA timezone database, from the runtime itself — no list to
// maintain, and it stays current as the database updates. Falls back to
// just UTC on a browser old enough not to support the API.
const TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
})();

export function ProfilePage() {
  const { user, updateUser } = useAuth();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [defaultCurrency, setDefaultCurrency] = useState(user?.defaultCurrency ?? "USD");
  const [timezone, setTimezone] = useState(user?.timezone ?? "UTC");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!user) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    try {
      const updated = await updateProfile.mutateAsync({
        displayName: displayName.trim(),
        defaultCurrency,
        timezone,
      });
      updateUser(updated);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  const initial = user.displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <AppShell>
      <div className="mb-6 flex items-center gap-4">
        <div className="h-14 w-14 shrink-0 rounded-full bg-ledger text-paper flex items-center justify-center text-xl font-semibold">
          {initial}
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">{user.displayName}</h1>
          <p className="text-sm text-ink-muted">{user.email}</p>
        </div>
      </div>

      <section className="mb-6 bg-white border border-line rounded-lg p-4">
        <h2 className="font-medium text-ink mb-3">Account</h2>
        <dl className="text-sm space-y-1.5">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Email verified</dt>
            <dd className={user.emailVerified ? "text-ledger" : "text-rust"}>{user.emailVerified ? "Yes" : "No"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Joined</dt>
            <dd className="text-ink">{formatDate(new Date(user.createdAt))}</dd>
          </div>
        </dl>
      </section>

      <section className="bg-white border border-line rounded-lg p-4">
        <h2 className="font-medium text-ink mb-3">Edit profile</h2>
        {error && <ErrorBanner message={error} />}
        {success && <SuccessBanner message="Profile updated." />}
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField label="Display name" value={displayName} onChange={setDisplayName} required />
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Default currency</span>
            <select
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              required
              className="w-32 rounded-md border border-line px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ledger/40 focus:border-ledger"
            >
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-ink mb-1">Timezone</span>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              required
              className="w-full rounded-md border border-line px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ledger/40 focus:border-ledger"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton disabled={updateProfile.isPending}>{updateProfile.isPending ? "Saving…" : "Save changes"}</SubmitButton>
        </form>
        <p className="mt-4 text-sm text-ink-muted">
          <Link to="/forgot-password" state={{ email: user.email }} className="text-ledger hover:underline">
            Change password
          </Link>
        </p>
      </section>
    </AppShell>
  );
}
