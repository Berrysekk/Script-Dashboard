"use client";
import { useState } from "react";
import Link from "next/link";
import LoopPicker, { formatLoopInterval } from "./LoopPicker";

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

const statusStyle: Record<string, { label: string; cls: string }> = {
  running: { label: "Running", cls: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" },
  success: { label: "Success", cls: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" },
  warning: { label: "Warning", cls: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" },
  error:   { label: "Error",   cls: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" },
  idle:    { label: "Idle",    cls: "bg-gray-100 text-gray-400 dark:bg-neutral-800 dark:text-gray-500" },
};

export default function ScriptCard({ script, onRun, onLoop, onStop, onLogs }: Props) {
  const [showLoopInput, setShowLoopInput] = useState(false);
  const [busy, setBusy]                   = useState(false);

  const isActive = script.status === "running" || script.loop_enabled;
  const statusKey = script.loop_enabled ? "running" : (script.status ?? "idle");
  const badge = script.loop_enabled
    ? { label: "Looping", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" }
    : (statusStyle[statusKey] ?? statusStyle.idle);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl overflow-hidden flex flex-col hover:bg-gray-50 dark:hover:bg-neutral-800/50 transition-colors">
      {/* Clickable header */}
      <Link
        href={`/scripts/${script.id}`}
        className="block px-4 pt-4 pb-3"
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-semibold text-sm leading-snug">{script.name}</h3>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
        {script.description && (
          <p className="text-xs text-gray-400 truncate">{script.description}</p>
        )}
        <div className="flex gap-3 mt-2 text-[10.5px] text-gray-400">
          {script.loop_enabled && script.loop_interval && (
            <span>{formatLoopInterval(script.loop_interval ?? "")}</span>
          )}
          {script.last_run_at && (
            <span>{new Date(script.last_run_at).toLocaleTimeString()}</span>
          )}
          <span>{script.run_count} runs</span>
        </div>
      </Link>

      {/* Loop picker */}
      {showLoopInput && (
        <div className="px-4 pb-3">
          <LoopPicker
            disabled={busy}
            onSelect={(interval) => act(async () => { await onLoop(script.id, interval); setShowLoopInput(false); })}
            onCancel={() => setShowLoopInput(false)}
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-1.5 px-4 pb-4">
        {!isActive ? (
          <>
            <button
              disabled={busy}
              onClick={() => act(() => onRun(script.id))}
              className="flex-1 text-xs bg-blue-500 hover:bg-blue-600 text-white py-1.5 rounded font-medium disabled:opacity-50"
            >
              {busy ? "..." : "Run"}
            </button>
            <button
              disabled={busy}
              onClick={() => setShowLoopInput(true)}
              className="flex-1 text-xs border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-800 py-1.5 rounded font-medium disabled:opacity-50"
            >
              Loop
            </button>
          </>
        ) : (
          <button
            disabled={busy}
            onClick={() => act(() => onStop(script.id))}
            className="flex-1 text-xs bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-800 hover:bg-red-100 py-1.5 rounded font-medium disabled:opacity-50"
          >
            {busy ? "..." : "Stop"}
          </button>
        )}
        <button
          onClick={() => onLogs(script.id)}
          className="text-xs border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-800 py-1.5 px-3 rounded font-medium"
        >
          Logs
        </button>
      </div>
    </div>
  );
}
