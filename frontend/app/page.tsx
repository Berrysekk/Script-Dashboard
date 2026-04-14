"use client";
import { useCallback, useEffect, useState } from "react";
import ScriptCard, { Script } from "./components/ScriptCard";
import UploadModal from "./components/UploadModal";
import LogDrawer   from "./components/LogDrawer";

type FilterView = "all" | "running" | "idle";

export default function Dashboard() {
  const [scripts, setScripts]       = useState<Script[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [logsFor, setLogsFor]       = useState<Script | null>(null);
  const [filter, setFilter]         = useState<FilterView>("all");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/scripts");
    if (res.ok) setScripts(await res.json());
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

  const filteredScripts = scripts.filter(s => {
    if (filter === "running") return s.status === "running" || s.loop_enabled;
    if (filter === "idle")    return s.status !== "running" && !s.loop_enabled;
    return true;
  });

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5">
          {(["all", "running", "idle"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1 rounded font-medium capitalize ${
                filter === f
                  ? "bg-blue-500 text-white"
                  : "text-gray-500 hover:bg-gray-100 dark:hover:bg-neutral-800"
              }`}
            >
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded font-medium"
        >
          + Add Script
        </button>
      </div>

      {filteredScripts.length === 0 ? (
        <p className="text-xs text-gray-400 mt-4">No scripts match this filter.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {filteredScripts.map(s => (
            <ScriptCard
              key={s.id}
              script={s}
              onRun={handleRun}
              onLoop={handleLoop}
              onStop={handleStop}
              onLogs={() => setLogsFor(s)}
            />
          ))}
        </div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={refresh} />}
      {logsFor && <LogDrawer scriptId={logsFor.id} scriptName={logsFor.name} onClose={() => setLogsFor(null)} />}
    </div>
  );
}
