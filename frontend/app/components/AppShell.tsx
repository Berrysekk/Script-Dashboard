"use client";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useSpring, useTransform } from "motion/react";
import { useAuth } from "./AuthGate";

type ScriptSummary = {
  id: string;
  name: string;
  status?: string;
  loop_enabled: boolean;
};

function AnimatedNumber({ value, color }: { value: number; color: string }) {
  const spring = useSpring(0, { stiffness: 80, damping: 15 });
  const display = useTransform(spring, v => Math.round(v));
  const [text, setText] = useState("0");

  useEffect(() => { spring.set(value); }, [spring, value]);
  useEffect(() => {
    const unsub = display.on("change", v => setText(String(v)));
    return unsub;
  }, [display]);

  return (
    <motion.span
      key={value}
      className={`text-sm font-bold tabular-nums ${color}`}
    >
      {text}
    </motion.span>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <AnimatedNumber value={value} color={color} />
      <span className="text-[11px] text-gray-400">{label}</span>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [mounted, setMounted] = useState(false);
  const prevPathRef = useRef(pathname);

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
    const onChanged = () => refresh();
    window.addEventListener("scripts-changed", onChanged);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("scripts-changed", onChanged);
    };
  }, [refresh]);

  // Track route changes for content animation
  const isNewRoute = prevPathRef.current !== pathname;
  useEffect(() => { prevPathRef.current = pathname; });

  // Login page: no shell
  if (pathname === "/login") return <>{children}</>;

  const total = scripts.length;
  const running = scripts.filter(s => s.status === "running").length;
  const looping = scripts.filter(s => s.loop_enabled).length;

  return (
    <>
      {/* Topbar content via portal */}
      {mounted && document.getElementById("topbar") && createPortal(
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-5 w-full"
        >
          <Stat label="Total" value={total} color="text-gray-600 dark:text-gray-300" />
          <Stat label="Running" value={running} color="text-blue-500 dark:text-blue-400" />
          <Stat label="Looping" value={looping} color="text-amber-500 dark:text-amber-400" />
          {user && (
            <span className="ml-auto text-[11px] text-gray-400">
              {user.username}
              <span className="ml-1 text-gray-300 dark:text-gray-600">({user.role})</span>
            </span>
          )}
        </motion.div>,
        document.getElementById("topbar")!,
      )}

      {/* Sidebar */}
      <motion.aside
        initial={{ x: -12, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="w-48 bg-white dark:bg-neutral-900 border-r border-gray-200 dark:border-neutral-800 flex flex-col shrink-0"
      >
        {/* Dashboard link */}
        <Link
          href="/"
          className={`flex items-center gap-2 px-4 py-2.5 text-[12.5px] border-b border-gray-200 dark:border-neutral-800 font-medium transition-colors duration-200
            ${pathname === "/" ? "text-blue-600" : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
        >
          Dashboard
        </Link>

        {/* Script list */}
        <div className="flex-1 overflow-y-auto py-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-1.5">Scripts</p>
          <AnimatePresence mode="popLayout">
            {scripts.map(s => {
              const active = pathname === `/scripts/${s.id}`;
              const isRunning = s.loop_enabled || s.status === "running";
              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8, height: 0 }}
                  transition={{ duration: 0.12 }}
                >
                  <Link
                    href={`/scripts/${s.id}`}
                    className={`flex items-center gap-2 px-4 py-1.5 text-[12.5px] w-full transition-colors duration-150
                      ${active
                        ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-semibold"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-800"}`}
                  >
                    <span className="relative flex shrink-0">
                      <span className={`w-1.5 h-1.5 rounded-full
                        ${isRunning ? "bg-green-400"
                          : s.status === "error" ? "bg-red-400"
                          : s.status === "warning" ? "bg-amber-400"
                          : s.status === "success" ? "bg-green-400"
                          : "bg-gray-200 dark:bg-neutral-700"}`} />
                      {isRunning && (
                        <motion.span
                          className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-green-400"
                          animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                        />
                      )}
                    </span>
                    <span className="truncate">{s.name}</span>
                  </Link>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Bottom actions */}
        <div className="border-t border-gray-200 dark:border-neutral-800 p-3 flex flex-col gap-1.5">
          <Link
            href="/databases"
            className={`text-xs px-3 py-1.5 rounded text-center font-medium transition-colors duration-200
              ${pathname?.startsWith("/databases")
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600"
                : "border border-gray-200 dark:border-neutral-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-neutral-800"}`}
          >
            Databases
          </Link>
          {user?.role === "admin" && (
            <Link
              href="/users"
              className={`text-xs px-3 py-1.5 rounded text-center font-medium transition-colors duration-200
                ${pathname === "/users"
                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600"
                  : "border border-gray-200 dark:border-neutral-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-neutral-800"}`}
            >
              Users
            </Link>
          )}
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded text-center font-medium border border-gray-200 dark:border-neutral-700 text-gray-500 hover:bg-red-50 dark:hover:bg-red-900/10 hover:text-red-500 hover:border-red-200 dark:hover:border-red-800 transition-colors duration-200"
          >
            Sign out
          </button>
        </div>
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={isNewRoute ? { opacity: 0, y: 4 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </>
  );
}
