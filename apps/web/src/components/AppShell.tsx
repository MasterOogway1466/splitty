import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext.js";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <nav className="flex items-center gap-4">
            <Link to="/" className="font-semibold text-slate-900">
              Splitty
            </Link>
            <Link to="/" className="text-sm text-slate-600 hover:text-slate-900">
              Groups
            </Link>
            <Link to="/friends" className="text-sm text-slate-600 hover:text-slate-900">
              Friends
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{user?.displayName}</span>
            <button onClick={() => void logout()} className="text-sm text-slate-500 hover:text-slate-900">
              Log out
            </button>
          </div>
        </div>
        {user && !user.emailVerified && (
          <div className="bg-amber-50 border-t border-amber-200 text-amber-800 text-sm px-4 py-2 text-center">
            Verify your email to unlock full account features.
          </div>
        )}
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
