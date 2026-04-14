"use client";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthGate";

type ScriptSummary = {
  id: string;
  name: string;
  status?: string;
  loop_enabled: boolean;
};

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[11px] text-gray-400">{label}</span>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/scripts");
      if (res.ok) setScripts(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Login page: no shell
  if (pathname === "/login") return <>{children}</>;

  const total = scripts.length;
  const running = scripts.filter(s => s.status === "running").length;
  const looping = scripts.filter(s => s.loop_enabled).length;

  return (
    <>
      {/* Topbar content via portal */}
      {mounted && document.getElementById("topbar") && createPortal(
        <div className="flex items-center gap-5 w-full px-5">
          <Stat label="Total" value={total} color="text-gray-600 dark:text-gray-300" />
          <Stat label="Running" value={running} color="text-green-500 dark:text-green-400" />
          <Stat label="Looping" value={looping} color="text-amber-500 dark:text-amber-400" />
          {user && (
            <span className="ml-auto text-[11px] text-gray-400">
              {user.username}
              <span className="ml-1 text-gray-300 dark:text-gray-600">({user.role})</span>
            </span>
          )}
        </div>,
        document.getElementById("topbar")!,
      )}

      {/* Sidebar */}
      <aside className="w-48 bg-white dark:bg-neutral-900 border-r border-gray-200 dark:border-neutral-800 flex flex-col shrink-0">
        {/* Dashboard link */}
        <Link
          href="/"
          className={`flex items-center gap-2 px-4 py-2.5 text-[12.5px] border-b border-gray-200 dark:border-neutral-800 font-medium
            ${pathname === "/" ? "text-blue-600" : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
        >
          Dashboard
        </Link>

        {/* Script list */}
        <div className="flex-1 overflow-y-auto py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-1.5">Scripts</p>
          {scripts.map(s => {
            const active = pathname === `/scripts/${s.id}`;
            return (
              <Link
                key={s.id}
                href={`/scripts/${s.id}`}
                className={`flex items-center gap-2 px-4 py-1.5 text-[12.5px] w-full
                  ${active
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-semibold"
                    : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-800"}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0
                  ${s.loop_enabled || s.status === "running" ? "bg-green-400"
                    : s.status === "error" ? "bg-red-400"
                    : s.status === "warning" ? "bg-amber-400"
                    : s.status === "success" ? "bg-green-400"
                    : "bg-gray-200 dark:bg-neutral-700"}`} />
                <span className="truncate">{s.name}</span>
              </Link>
            );
          })}
        </div>

        {/* Bottom actions */}
        <div className="border-t border-gray-200 dark:border-neutral-800 p-3 flex flex-col gap-1.5">
          {user?.role === "admin" && (
            <Link
              href="/users"
              className={`text-xs px-3 py-1.5 rounded text-center font-medium
                ${pathname === "/users"
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600"
                  : "border border-gray-200 dark:border-neutral-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-neutral-800"}`}
            >
              Users
            </Link>
          )}
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded text-center font-medium border border-gray-200 dark:border-neutral-700 text-gray-500 hover:bg-red-50 dark:hover:bg-red-900/10 hover:text-red-500 hover:border-red-200 dark:hover:border-red-800"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </>
  );
}
