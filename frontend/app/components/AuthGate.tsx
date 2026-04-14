"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export type CurrentUser = { id: string; username: string; role: "admin" | "user" };

type Ctx = {
  user: CurrentUser | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<Ctx>({
  user: null,
  refresh: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

/**
 * Wraps the app. On mount, fetches /api/auth/me. If we're on /login it stays
 * passive and just renders children. Otherwise: loading → splash, 401 →
 * redirect to /login, success → render children inside the AuthContext.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const isLoginPage = pathname === "/login";

  const [user, setUser]       = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(!isLoginPage);

  const refresh = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        setUser(await res.json());
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/login");
  };

  useEffect(() => {
    if (isLoginPage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      await refresh();
      if (cancelled) return;
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // After loading, if we're not on /login and have no user, bounce.
  useEffect(() => {
    if (loading || isLoginPage) return;
    if (!user) router.replace("/login");
  }, [loading, user, isLoginPage, router]);

  if (isLoginPage) {
    return (
      <AuthContext.Provider value={{ user, refresh, logout }}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (loading || !user) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
