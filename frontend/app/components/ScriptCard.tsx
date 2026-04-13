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
  onRun:  (id: string) => void;
  onLoop: (id: string, interval: string) => void;
  onStop: (id: string) => void;
  onLogs: (id: string) => void;
};

const statusClass: Record<string, string> = {
  running: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  success: "bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-gray-400",
  error:   "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  idle:    "bg-gray-100 text-gray-400 dark:bg-neutral-800 dark:text-gray-500",
};

export default function ScriptCard({ script, onRun, onLoop, onStop, onLogs }: Props) {
  const [showInterval, setShowInterval] = useState(false);
  const [interval, setInterval]         = useState(script.loop_interval || "1h");
  const isActive = script.status === "running" || script.loop_enabled;
  const badge    = script.loop_enabled ? "Looping" : (script.status ?? "idle");
  const bClass   = statusClass[script.loop_enabled ? "running" : (script.status ?? "idle")];

  return (
    <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link href={`/scripts/${script.id}`} className="font-semibold text-sm hover:underline">
            {script.name}
          </Link>
          {script.description && <p className="text-xs text-gray-400 mt-0.5">{script.description}</p>}
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${bClass}`}>
          {script.loop_enabled ? "● Looping" : badge.charAt(0).toUpperCase() + badge.slice(1)}
        </span>
      </div>

      <div className="flex gap-3 flex-wrap">
        {script.loop_enabled && script.loop_interval &&
          <span className="text-[10.5px] text-gray-400">🔁 every {script.loop_interval}</span>}
        {script.last_run_at &&
          <span className="text-[10.5px] text-gray-400">⏱ {new Date(script.last_run_at).toLocaleTimeString()}</span>}
        <span className="text-[10.5px] text-gray-400">✓ {script.run_count} runs</span>
      </div>

      {showInterval && (
        <div className="flex gap-1">
          <input className="flex-1 text-xs border border-gray-300 dark:border-neutral-700 rounded px-2 py-1 bg-transparent"
            value={interval} onChange={(e) => setInterval(e.target.value)} placeholder="e.g. 6h, 30m, 5s, 1d" />
          <button className="text-xs bg-blue-500 text-white px-2 py-1 rounded"
            onClick={() => { onLoop(script.id, interval); setShowInterval(false); }}>Start</button>
          <button className="text-xs text-gray-400 px-1" onClick={() => setShowInterval(false)}>✕</button>
        </div>
      )}

      <div className="flex gap-1.5">
        {!isActive ? (
          <>
            <button onClick={() => onRun(script.id)}
              className="flex-1 text-xs bg-blue-500 text-white py-1 rounded font-medium">▶ Run</button>
            <button onClick={() => setShowInterval(true)}
              className="flex-1 text-xs border border-gray-200 dark:border-neutral-700 py-1 rounded font-medium">🔁 Loop</button>
          </>
        ) : (
          <button onClick={() => onStop(script.id)}
            className="flex-1 text-xs bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-800 py-1 rounded font-medium">Stop</button>
        )}
        <button onClick={() => onLogs(script.id)}
          className="flex-1 text-xs border border-gray-200 dark:border-neutral-700 py-1 rounded font-medium">Logs</button>
      </div>
    </div>
  );
}
