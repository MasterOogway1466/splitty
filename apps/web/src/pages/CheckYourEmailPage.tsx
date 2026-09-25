import { useLocation } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout.js";

export function CheckYourEmailPage() {
  const location = useLocation();
  const email = (location.state as { email?: string } | null)?.email;

  return (
    <AuthLayout title="Check your email">
      <p className="text-sm text-ink-muted">
        We sent a verification link{email ? ` to ${email}` : ""}. Click it to verify your account, then log in.
      </p>
    </AuthLayout>
  );
}
