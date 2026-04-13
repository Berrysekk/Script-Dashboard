"use client";
import { useState } from "react";
import Link from "next/link";

export type Script = {
  id: string; name: string; filename: string; description?: string;
  status?: string; loop_enabled: boolean; loop_interval?: string;
  last_run_at?: string; run_count: number;
};

type Props = {
  script: Script;
  onRun:  (id: string) => Promise<void>;
  onLoop: (id: string, interval: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onLogs: (id: string) => void;
};

const statusColor: Record<string, string> = {
  running: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  success: "bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-gray-400",
  error:   "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  idle:    "bg-gray-100 text-gray-400 dark:bg-neutral-800 dark:text-gray-500",
};

export default function ScriptCard({ script, onRun, onLoop, onStop, onLogs }: Props) {
  const [showLoopInput, setShowLoopInput] = useState(false);
  const [loopInterval, setLoopInterval]   = useState(script.loop_interval || "1h");
  const [busy, setBusy]                   = useState(false);

  const isActive = script.status === "running" || script.loop_enabled;
  const statusKey = script.loop_enabled ? "running" : (script.status ?? "idle");
  const badgeLabel = script.loop_enabled
    ? "● Looping"
    : (statusKey.charAt(0).toUpperCase() + statusKey.slice(1));

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/scripts/${script.id}`} className="font-semibold text-sm hover:underline truncate block">
            {script.name}
          </Link>
          {script.description && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{script.description}</p>
          )}
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${statusColor[statusKey] ?? statusColor.idle}`}>
          {badgeLabel}
        </span>
      </div>

      {/* Meta */}
      <div className="flex gap-3 flex-wrap">
        {script.loop_enabled && script.loop_interval && (
          <span className="text-[10.5px] text-gray-400">🔁 every {script.loop_interval}</span>
        )}
        {script.last_run_at && (
          <span className="text-[10.5px] text-gray-400">
            ⏱ {new Date(script.last_run_at).toLocaleTimeString()}
          </span>
        )}
        <span className="text-[10.5px] text-gray-400">✓ {script.run_count} runs</span>
      </div>

      {/* Loop interval input */}
      {showLoopInput && (
        <div className="flex gap-1">
          <input
            className="flex-1 text-xs border border-gray-300 dark:border-neutral-700 rounded px-2 py-1 bg-transparent"
            value={loopInterval}
            onChange={(e) => setLoopInterval(e.target.value)}
            placeholder="e.g. 6h, 30m, 5s, 1d"
            autoFocus
          />
          <button
            disabled={busy}
            className="text-xs bg-blue-500 text-white px-2 py-1 rounded disabled:opacity-50"
            onClick={() => act(async () => { await onLoop(script.id, loopInterval); setShowLoopInput(false); })}
          >
            Start
          </button>
          <button className="text-xs text-gray-400 px-1" onClick={() => setShowLoopInput(false)}>✕</button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1.5">
        {!isActive ? (
          <>
            <button
              disabled={busy}
              onClick={() => act(() => onRun(script.id))}
              className="flex-1 text-xs bg-blue-500 text-white py-1 rounded font-medium disabled:opacity-50"
            >
              {busy ? "…" : "▶ Run"}
            </button>
            <button
              disabled={busy}
              onClick={() => setShowLoopInput(true)}
              className="flex-1 text-xs border border-gray-200 dark:border-neutral-700 py-1 rounded font-medium disabled:opacity-50"
            >
              🔁 Loop
            </button>
          </>
        ) : (
          <button
            disabled={busy}
            onClick={() => act(() => onStop(script.id))}
            className="flex-1 text-xs bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-800 py-1 rounded font-medium disabled:opacity-50"
          >
            {busy ? "…" : "■ Stop"}
          </button>
        )}
        <button
          onClick={() => onLogs(script.id)}
          className="flex-1 text-xs border border-gray-200 dark:border-neutral-700 py-1 rounded font-medium"
        >
          Logs
        </button>
        <Link
          href={`/scripts/${script.id}`}
          className="text-xs border border-gray-200 dark:border-neutral-700 py-1 px-2 rounded font-medium flex items-center"
          title="Edit / detail"
        >
          ✎
        </Link>
      </div>
    </div>
  );
}
