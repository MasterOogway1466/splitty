import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { UserProfile } from "@splitty/shared";
import { apiGet, apiPost, setAccessToken } from "./api.js";

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<{ userId: string }>;
  logout: () => Promise<void>;
  /** Adopts a session obtained outside the normal login call (e.g. an
   * invite-accept response, which already returns an access token and
   * sets the refresh cookie) without a redundant extra round trip. */
  setSession: (accessToken: string, user: UserProfile) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore a session from the httpOnly refresh cookie on first load —
    // the access token itself only ever lives in memory (§5), so a page
    // reload always starts from here.
    (async () => {
      try {
        const body = (await apiPost("/auth/refresh")) as { accessToken: string };
        setAccessToken(body.accessToken);
        const profile = await apiGet("/auth/me");
        setUser(profile as UserProfile);
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    const body = (await apiPost("/auth/login", { email, password })) as { accessToken: string; user: UserProfile };
    setAccessToken(body.accessToken);
    setUser(body.user);
  }

  async function signup(email: string, password: string, displayName: string) {
    return (await apiPost("/auth/signup", { email, password, displayName })) as { userId: string };
  }

  async function logout() {
    await apiPost("/auth/logout").catch(() => {});
    setAccessToken(null);
    setUser(null);
  }

  function setSession(accessToken: string, sessionUser: UserProfile) {
    setAccessToken(accessToken);
    setUser(sessionUser);
  }

  return <AuthContext.Provider value={{ user, loading, login, signup, logout, setSession }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
