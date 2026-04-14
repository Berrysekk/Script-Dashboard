"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "login" | "reset";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode]         = useState<Mode>("login");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [master, setMaster]     = useState("");
  const [newPassword, setNew]   = useState("");

  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState("");
  const [info, setInfo]         = useState("");

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(""); setInfo("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? "Invalid credentials" : await res.text());
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(""); setInfo("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          master_password: master,
          new_password: newPassword,
        }),
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Invalid master password");
        if (res.status === 404) throw new Error("User not found");
        throw new Error(await res.text());
      }
      setInfo("Password reset. You can now sign in with the new password.");
      setPassword(newPassword);
      setMaster("");
      setNew("");
      setMode("login");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-2 mb-3 bg-transparent " +
    "focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl p-6 shadow-xl">
        <h1 className="text-sm font-semibold mb-4">
          {mode === "login" ? "Sign in" : "Reset password"}
        </h1>

        {mode === "login" ? (
          <form onSubmit={submitLogin}>
            <label className="block text-[10px] text-gray-400 mb-1">Username</label>
            <input
              className={inputCls}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
            <label className="block text-[10px] text-gray-400 mb-1">Password</label>
            <input
              type="password"
              className={inputCls}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {info && <p className="text-xs text-green-500 mb-2">{info}</p>}
            {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
            <button
              type="submit"
              disabled={busy || !username || !password}
              className="w-full text-sm bg-blue-500 text-white rounded px-3 py-2 disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("reset"); setError(""); setInfo(""); }}
              className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 mt-3"
            >
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={submitReset}>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
              Enter your username, the shared master password, and a new password. The master
              password is set by the operator at install time and can only be rotated from inside
              the container.
            </p>
            <label className="block text-[10px] text-gray-400 mb-1">Username</label>
            <input
              className={inputCls}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
            <label className="block text-[10px] text-gray-400 mb-1">Master password</label>
            <input
              type="password"
              className={inputCls}
              value={master}
              onChange={(e) => setMaster(e.target.value)}
            />
            <label className="block text-[10px] text-gray-400 mb-1">New password</label>
            <input
              type="password"
              className={inputCls}
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              autoComplete="new-password"
            />
            {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
            <button
              type="submit"
              disabled={busy || !username || !master || !newPassword}
              className="w-full text-sm bg-blue-500 text-white rounded px-3 py-2 disabled:opacity-50"
            >
              {busy ? "Resetting…" : "Reset password"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("login"); setError(""); setInfo(""); }}
              className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 mt-3"
            >
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
