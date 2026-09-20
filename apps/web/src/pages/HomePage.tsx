import { useAuth } from "../lib/AuthContext.js";

export function HomePage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h1 className="text-xl font-semibold text-slate-900">Welcome, {user?.displayName}</h1>
        <p className="mt-2 text-sm text-slate-600">{user?.email}</p>
        {!user?.emailVerified && (
          <p className="mt-4 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
            Verify your email to unlock groups and expenses.
          </p>
        )}
        <p className="mt-6 text-sm text-slate-500">
          Groups, expenses, and balances land in Phase 1 — this page just proves signup, verification, and login
          work end to end.
        </p>
        <button
          onClick={() => void logout()}
          className="mt-6 w-full rounded-md border border-slate-300 text-slate-700 text-sm font-medium py-2 hover:bg-slate-50"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
