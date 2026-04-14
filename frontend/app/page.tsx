"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import ScriptCard, { Script } from "./components/ScriptCard";
import UploadModal from "./components/UploadModal";
import LogDrawer   from "./components/LogDrawer";
import { useAuth } from "./components/AuthGate";

type FilterView = "all" | "running" | "idle";

function SidebarItem({ label, active, dot, onClick }: {
  label: string; active?: boolean; dot?: "green"|"red"; onClick?: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-1.5 text-[12.5px] text-left w-full
        ${active ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-semibold"
                 : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-800"}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0
        ${dot==="green" ? "bg-green-400" : dot==="red" ? "bg-red-400" : "bg-gray-200 dark:bg-neutral-700"}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function TopBarStats({ total, running, looping }: { total: number; running: number; looping: number }) {
  const [mounted, setMounted] = useState(false);
  const { user, logout } = useAuth();
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  const el = document.getElementById("topbar");
  if (!el) return null;

  return createPortal(
    <div className="flex items-center gap-5 w-full px-5">
      <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 mr-2">Script Dashboard</span>
      <span className="h-4 w-px bg-gray-200 dark:bg-neutral-700" />
      <Stat label="Total" value={total}   color="text-gray-600 dark:text-gray-300" />
      <Stat label="Running" value={running} color="text-green-500 dark:text-green-400" />
      <Stat label="Looping" value={looping} color="text-amber-500 dark:text-amber-400" />
      <div className="ml-auto flex items-center gap-3">
        {user && (
          <span className="text-[11px] text-gray-400">
            {user.username}
            <span className="ml-1 text-gray-300 dark:text-gray-600">({user.role})</span>
          </span>
        )}
        {user?.role === "admin" && (
          <Link href="/users" className="text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            Users
          </Link>
        )}
        <button
          onClick={logout}
          className="text-[11px] text-gray-400 hover:text-red-500"
        >
          Sign out
        </button>
      </div>
    </div>,
    el,
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[11px] text-gray-400">{label}</span>
    </div>
  );
}

export default function Dashboard() {
  const [scripts, setScripts]       = useState<Script[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [logsFor, setLogsFor]       = useState<Script | null>(null);
  const [filter, setFilter]         = useState<FilterView>("all");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/scripts");
    setScripts(await res.json());
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleRun  = async (id: string) => {
    await fetch(`/api/scripts/${id}/run`, { method: "POST" });
    await refresh();
  };
  const handleStop = async (id: string) => {
    await fetch(`/api/scripts/${id}/stop`, { method: "POST" });
    await refresh();
  };
  const handleLoop = async (id: string, interval: string) => {
    await fetch(`/api/scripts/${id}/loop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval }),
    });
    await refresh();
  };

  const total   = scripts.length;
  const running = scripts.filter(s => s.status === "running").length;
  const looping = scripts.filter(s => s.loop_enabled).length;

  const filteredScripts = scripts.filter(s => {
    if (filter === "running") return s.status === "running" || s.loop_enabled;
    if (filter === "idle")    return s.status !== "running" && !s.loop_enabled;
    return true;
  });

  return (
    <>
      <TopBarStats total={total} running={running} looping={looping} />

      <aside className="w-48 bg-white dark:bg-neutral-900 border-r border-gray-200 dark:border-neutral-800 flex flex-col py-3 gap-0.5 shrink-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2">Views</p>
        <SidebarItem label="All Scripts" active={filter === "all"}     onClick={() => setFilter("all")} />
        <SidebarItem label="Running"     active={filter === "running"} dot="green" onClick={() => setFilter("running")} />
        <SidebarItem label="Idle"        active={filter === "idle"}    onClick={() => setFilter("idle")} />

        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-2">Scripts</p>
        {scripts.map(s => (
          <Link
            key={s.id}
            href={`/scripts/${s.id}`}
            className="flex items-center gap-2 px-4 py-1.5 text-[12.5px] text-left w-full
              text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-800"
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0
              ${s.loop_enabled || s.status === "running" ? "bg-green-400"
                : s.status === "error"   ? "bg-red-400"
                : s.status === "warning" ? "bg-amber-400"
                : "bg-gray-200 dark:bg-neutral-700"}`} />
            <span className="truncate">{s.name}</span>
          </Link>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Scripts
            {filter !== "all" && (
              <span className="ml-2 text-blue-500 capitalize">({filter})</span>
            )}
          </p>
          <button onClick={() => setShowUpload(true)}
            className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded font-medium">
            + Add Script
          </button>
        </div>

        {filteredScripts.length === 0 ? (
          <p className="text-xs text-gray-400 mt-4">No scripts match this filter.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {filteredScripts.map(s => (
              <ScriptCard key={s.id} script={s}
                onRun={handleRun} onLoop={handleLoop} onStop={handleStop}
                onLogs={() => setLogsFor(s)} />
            ))}
          </div>
        )}
      </main>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={refresh} />}
      {logsFor && <LogDrawer scriptId={logsFor.id} scriptName={logsFor.name} onClose={() => setLogsFor(null)} />}
    </>
  );
}
