import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext.js";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-ledger">
        <div className="max-w-2xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <nav className="flex items-center gap-5">
            <Link to="/" className="font-semibold text-paper text-[15px] tracking-tight">
              Splitty
            </Link>
            <Link to="/" className="text-sm text-paper/75 hover:text-paper transition-colors">
              Groups
            </Link>
            <Link to="/friends" className="text-sm text-paper/75 hover:text-paper transition-colors">
              Friends
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <span className="text-sm text-paper/75">{user?.displayName}</span>
            <button onClick={() => void logout()} className="text-sm text-paper/75 hover:text-paper transition-colors">
              Log out
            </button>
          </div>
        </div>
        {user && !user.emailVerified && (
          <div className="bg-gold/20 text-paper text-sm px-5 py-2 text-center">Verify your email to unlock full account features.</div>
        )}
      </header>
      <main className="max-w-2xl mx-auto px-5 py-8">{children}</main>
    </div>
  );
}
