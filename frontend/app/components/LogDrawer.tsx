"use client";
import { useEffect, useRef, useState, Fragment, type ReactNode } from "react";
import { motion } from "motion/react";

type Run = { id: string; started_at: string; finished_at?: string; exit_code?: number; status: string; };
type Props = { scriptId: string | null; scriptName: string; onClose: () => void; initialRunId?: string; };

// Minimal ANSI SGR parser — covers the 8 standard + bright foreground colors,
// bold, dim, and reset. Anything else is stripped. Enough for typical CLI output.
const ANSI_FG: Record<number, string> = {
  30: "text-gray-500",   90: "text-gray-400",
  31: "text-red-500",    91: "text-red-400",
  32: "text-green-600 dark:text-green-400", 92: "text-green-400",
  33: "text-amber-500",  93: "text-amber-400",
  34: "text-blue-500",   94: "text-blue-400",
  35: "text-fuchsia-500",95: "text-fuchsia-400",
  36: "text-cyan-500",   96: "text-cyan-400",
  37: "text-gray-300",   97: "text-white",
};

function renderAnsi(line: string): ReactNode {
  // Match CSI SGR sequences: ESC [ <params> m
  const matches = [...line.matchAll(/\x1b\[([0-9;]*)m/g)];
  if (matches.length === 0) return line;
  const out: ReactNode[] = [];
  let last = 0;
  let fg: string | null = null;
  let bold = false;
  let key = 0;

  const flush = (text: string) => {
    if (!text) return;
    const cls = [fg, bold ? "font-semibold" : ""].filter(Boolean).join(" ");
    out.push(cls ? <span key={key++} className={cls}>{text}</span> : <Fragment key={key++}>{text}</Fragment>);
  };

  for (const m of matches) {
    flush(line.slice(last, m.index));
    const codes = m[1].split(";").filter(Boolean).map(Number);
    if (codes.length === 0) codes.push(0);
    for (const c of codes) {
      if (c === 0) { fg = null; bold = false; }
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) fg = null;
      else if (ANSI_FG[c]) fg = ANSI_FG[c];
    }
    last = (m.index ?? 0) + m[0].length;
  }
  flush(line.slice(last));
  return out;
}

function duration(start: string, end?: string) {
  if (!end) return "running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 60000 ? `${(ms/1000).toFixed(1)}s` : `${Math.floor(ms/60000)}m ${Math.floor((ms%60000)/1000)}s`;
}

export default function LogDrawer({ scriptId, scriptName, onClose, initialRunId }: Props) {
  const [runs, setRuns]               = useState<Run[]>([]);
  const [selected, setSelected]       = useState<Run | null>(null);
  const [lines, setLines]             = useState<string[]>([]);
  const [dates, setDates]             = useState<string[]>([]);
  const [activeDate, setActiveDate]   = useState("");
  const logRef                        = useRef<HTMLDivElement>(null);
  const prevLenRef                    = useRef(0);

  useEffect(() => {
    if (!scriptId) return;
    const load = () => {
      fetch(`/api/scripts/${scriptId}`).then(r => r.json()).then(data => {
        const allRuns: Run[] = data.runs ?? [];
        setRuns(allRuns);
        const uniqDates = [...new Set(allRuns.map(r => r.started_at.slice(0,10)))].sort().reverse();
        setDates(uniqDates);
        if (uniqDates.length) setActiveDate(prev => prev || uniqDates[0]);
        setSelected(prev => {
          if (prev) {
            const updated = allRuns.find(r => r.id === prev.id);
            return updated ?? prev;
          }
          if (initialRunId) {
            const match = allRuns.find(r => r.id === initialRunId);
            if (match) {
              setActiveDate(match.started_at.slice(0, 10));
              return match;
            }
          }
          return allRuns[0] ?? null;
        });
      });
    };
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [scriptId]);

  useEffect(() => {
    if (!selected) return;
    setLines([]);
    prevLenRef.current = 0;

    const fetchLog = () => {
      fetch(`/api/runs/${selected.id}/log`)
        .then(r => r.ok ? r.text() : "")
        .then(t => {
          if (!t) return;
          const newLines = t.split("\n");
          const grew = newLines.length > prevLenRef.current;
          prevLenRef.current = newLines.length;
          setLines(newLines);
          if (grew) {
            requestAnimationFrame(() => {
              if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
            });
          }
        })
        .catch(() => {});
    };

    fetchLog();
    const id = setInterval(fetchLog, 1000);
    return () => clearInterval(id);
  }, [selected?.id]);

  const runsForDate = runs.filter(r => r.started_at.startsWith(activeDate));
  if (!scriptId) return null;

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="fixed inset-0 z-30"
        onClick={onClose}
      />
      {/* Drawer */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        className="fixed inset-x-0 bottom-0 z-40 h-[50vh] bg-white dark:bg-neutral-900 border-t border-gray-200 dark:border-neutral-800 flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-neutral-800">
          <span className="text-xs font-semibold">Logs — {scriptName}</span>
          <div className="flex items-center gap-3">
            <div className="flex">
              {dates.slice(0,7).map(d => (
                <button key={d} onClick={() => setActiveDate(d)}
                  className={`text-[11px] px-2.5 py-1 border border-gray-200 dark:border-neutral-700 -ml-px first:rounded-l last:rounded-r transition-colors duration-150
                    ${activeDate === d ? "bg-blue-500 text-white border-blue-500 z-10" : "text-gray-500"}`}>{d}</button>
              ))}
            </div>
            {selected && (
              <a href={`/api/runs/${selected.id}/log`} download
                className="text-xs border border-gray-200 dark:border-neutral-700 px-2.5 py-1 rounded">Download</a>
            )}
            <button onClick={onClose} className="text-gray-400 text-sm ml-1 hover:text-gray-600 transition-colors">✕</button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-52 border-r border-gray-200 dark:border-neutral-800 overflow-y-auto">
            {runsForDate.map(r => (
              <motion.button
                key={r.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setSelected(r)}
                className={`w-full text-left px-3 py-2 border-b border-gray-100 dark:border-neutral-800 transition-colors duration-150
                  ${selected?.id === r.id ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-neutral-800"}`}
              >
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
              </motion.button>
            ))}
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
            {lines.map((line, i) => {
              const hasAnsi = line.includes("\x1b[");
              const fallback = !hasAnsi && (
                /error|exception|traceback/i.test(line) ? "text-red-500 dark:text-red-400"
                  : /warn/i.test(line)                 ? "text-amber-500 dark:text-amber-400"
                  : /✓|success/i.test(line)            ? "text-green-600 dark:text-green-400"
                  : ""
              );
              return (
                <div key={i} className={fallback || ""}>
                  {line ? renderAnsi(line) : "\u00a0"}
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </>
  );
}
