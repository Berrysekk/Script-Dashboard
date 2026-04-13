"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StatsBar    from "./components/StatsBar";
import ScriptCard, { Script } from "./components/ScriptCard";
import UploadModal from "./components/UploadModal";
import LogDrawer   from "./components/LogDrawer";

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

  const stats = {
    total:     scripts.length,
    running:   scripts.filter(s => s.status === "running").length,
    looping:   scripts.filter(s => s.loop_enabled).length,
    runsToday: 0,
  };

  const filteredScripts = scripts.filter(s => {
    if (filter === "running") return s.status === "running" || s.loop_enabled;
    if (filter === "idle")    return s.status !== "running" && !s.loop_enabled;
    return true;
  });

  return (
    <>
      <aside className="w-48 bg-white dark:bg-neutral-900 border-r border-gray-200 dark:border-neutral-800 flex flex-col py-3 gap-0.5 shrink-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 py-2">Views</p>
        <SidebarItem label="All Scripts" active={filter === "all"}    onClick={() => setFilter("all")} />
        <SidebarItem label="Running"     active={filter === "running"} dot="green" onClick={() => setFilter("running")} />
        <SidebarItem label="Idle"        active={filter === "idle"}   onClick={() => setFilter("idle")} />

        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-2">Scripts</p>
        {scripts.map(s => (
          <Link
            key={s.id}
            href={`/scripts/${s.id}`}
            className={`flex items-center gap-2 px-4 py-1.5 text-[12.5px] text-left w-full
              text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-neutral-800`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0
              ${s.loop_enabled || s.status === "running" ? "bg-green-400"
                : s.status === "error" ? "bg-red-400"
                : "bg-gray-200 dark:bg-neutral-700"}`} />
            <span className="truncate">{s.name}</span>
          </Link>
        ))}

        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-4 pt-4 pb-2">Logs</p>
        <SidebarItem label="By Date" />
        <SidebarItem label="Downloads" />
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
            className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded font-medium">+ Add Script</button>
        </div>
        <StatsBar {...stats} />
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
