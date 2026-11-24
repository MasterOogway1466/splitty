import { useLocation } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.js";

export function CheckYourEmailPage() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;

  return (
    <AuthLayout title="Check your email">
      <p className="text-sm text-ink-muted">
        We sent a link{email ? ` to ${email}` : ""}. Open it to finish setting up your account.
      </p>
    </AuthLayout>
  );
}
