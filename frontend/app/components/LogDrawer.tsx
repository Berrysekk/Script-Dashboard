"use client";
import { useEffect, useRef, useState } from "react";

type Run = { id: string; started_at: string; finished_at?: string; exit_code?: number; status: string; };
type Props = { scriptId: string | null; scriptName: string; onClose: () => void; };

function duration(start: string, end?: string) {
  if (!end) return "running…";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 60000 ? `${(ms/1000).toFixed(1)}s` : `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s`;
}

export default function LogDrawer({ scriptId, scriptName, onClose }: Props) {
  const [runs, setRuns]               = useState<Run[]>([]);
  const [selected, setSelected]       = useState<Run | null>(null);
  const [lines, setLines]             = useState<string[]>([]);
  const [dates, setDates]             = useState<string[]>([]);
  const [activeDate, setActiveDate]   = useState("");
  const logRef                        = useRef<HTMLDivElement>(null);
  const wsRef                         = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!scriptId) return;
    fetch(`/api/scripts/${scriptId}`).then(r => r.json()).then(data => {
      const allRuns: Run[] = data.runs ?? [];
      setRuns(allRuns);
      const uniqDates = [...new Set(allRuns.map(r => r.started_at.slice(0,10)))].sort().reverse();
      setDates(uniqDates);
      if (uniqDates.length) setActiveDate(uniqDates[0]);
      if (allRuns[0]) setSelected(allRuns[0]);
    });
  }, [scriptId]);

  useEffect(() => {
    if (!selected) return;
    setLines([]);
    wsRef.current?.close();
    if (selected.status === "running") {
      const ws = new WebSocket(`ws://${location.host}/ws/runs/${selected.id}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        setLines(p => [...p, e.data]);
        requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; });
      };
      return () => ws.close();
    } else {
      fetch(`/api/runs/${selected.id}/log`).then(r => r.text()).then(t => setLines(t.split("\n")));
    }
  }, [selected?.id]);

  const runsForDate = runs.filter(r => r.started_at.startsWith(activeDate));
  if (!scriptId) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 h-[50vh] bg-white dark:bg-neutral-900 border-t border-gray-200 dark:border-neutral-800 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-neutral-800">
        <span className="text-xs font-semibold">Logs — {scriptName}</span>
        <div className="flex items-center gap-3">
          <div className="flex">
            {dates.slice(0,7).map(d => (
              <button key={d} onClick={() => setActiveDate(d)}
                className={`text-[11px] px-2.5 py-1 border border-gray-200 dark:border-neutral-700 -ml-px first:rounded-l last:rounded-r
                  ${activeDate === d ? "bg-blue-500 text-white border-blue-500 z-10" : "text-gray-500"}`}>{d}</button>
            ))}
          </div>
          {selected && (
            <a href={`/api/runs/${selected.id}/log`} download
              className="text-xs border border-gray-200 dark:border-neutral-700 px-2.5 py-1 rounded">⬇ Download</a>
          )}
          <button onClick={onClose} className="text-gray-400 text-sm ml-1">✕</button>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-52 border-r border-gray-200 dark:border-neutral-800 overflow-y-auto">
          {runsForDate.map(r => (
            <button key={r.id} onClick={() => setSelected(r)}
              className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-neutral-800
                ${selected?.id === r.id ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-neutral-800"}`}>
              <p className="text-[11px] font-mono">{new Date(r.started_at).toLocaleTimeString()}</p>
              <div className="flex gap-1.5 mt-0.5">
                <span className={`text-[10px] font-semibold px-1.5 rounded-full
                  ${r.status==="success" ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                    : r.status==="error" ? "bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-blue-100 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400"}`}>
                  {r.exit_code != null ? `exit ${r.exit_code}` : r.status}
                </span>
                <span className="text-[10px] text-gray-400">{duration(r.started_at, r.finished_at)}</span>
              </div>
            </button>
          ))}
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed text-gray-500 dark:text-gray-400">
          {lines.map((line, i) => (
            <div key={i} className={
              /error|exception|traceback/i.test(line) ? "text-red-500 dark:text-red-400"
                : /warn/i.test(line)                 ? "text-amber-500 dark:text-amber-400"
                : /✓|success/i.test(line)            ? "text-green-600 dark:text-green-400"
                : ""
            }>{line || "\u00a0"}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
