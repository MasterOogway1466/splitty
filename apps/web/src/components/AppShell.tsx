import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext.js";
import { Icon } from "./Icon.js";

const onGreenFocus = "outline-none focus-visible:ring-2 focus-visible:ring-paper";

/** Pages opened from a section keep that section marked as current. */
const SECTIONS = [
  { to: "/", label: "Groups", within: /^\/($|groups)/ },
  { to: "/friends", label: "Friends", within: /^\/(friends|people)/ },
  { to: "/activity", label: "Activity", within: /^\/activity/ },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-ledger">
        <div className="max-w-2xl mx-auto px-5 py-2.5 flex flex-wrap items-center justify-between gap-x-5 gap-y-1">
          <nav aria-label="Main" className="flex items-center gap-1">
            <Link to="/" className={`mr-2 rounded-md font-semibold text-paper text-[15px] tracking-tight ${onGreenFocus}`}>
              Splitty
            </Link>
            {SECTIONS.map(({ to, label, within }) => {
              const current = within.test(pathname);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={current ? "page" : undefined}
                  className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${onGreenFocus} ${
                    current ? "bg-paper text-ledger" : "text-paper hover:bg-paper/15"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="-ml-2 flex items-center gap-2 sm:ml-0">
            <NavLink
              to="/profile"
              title="Your profile"
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-paper transition-colors hover:bg-paper/15 ${onGreenFocus} ${isActive ? "bg-paper/15" : ""}`
              }
            >
              <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-paper text-xs font-semibold text-ledger">
                {user?.displayName.trim()[0]?.toUpperCase()}
              </span>
              <span className="max-w-32 truncate">{user?.displayName}</span>
            </NavLink>
            <button
              type="button"
              onClick={() => void logout()}
              className={`inline-flex items-center gap-1.5 rounded-md border border-paper/50 px-2.5 py-1 text-sm font-medium text-paper transition-colors hover:border-paper hover:bg-paper/15 ${onGreenFocus}`}
            >
              <Icon name="leave" />
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-5 py-8">{children}</main>
    </div>
  );
}
