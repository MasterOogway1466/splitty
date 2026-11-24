import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { VerifyEmailNotice } from "./VerifyEmailNotice.js";
import { useAuth } from "../lib/AuthContext.js";

export function ProtectedRoute({ children, allowUnverified = false }: { children: ReactNode; allowUnverified?: boolean }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-paper text-ink-muted text-sm">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!user.emailVerified && !allowUnverified) {
    return <VerifyEmailNotice />;
  }
  return <>{children}</>;
}
