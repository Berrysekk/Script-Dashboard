"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Run    = { id: string; started_at: string; finished_at?: string; exit_code?: number; status: string; };
type Script = {
  id: string; name: string; filename: string; description?: string;
  loop_enabled: boolean; loop_interval?: string; status?: string; runs: Run[];
};
type OutputFile = { filename: string; size: number; modified: string; };

const dur = (s: string, e?: string) => {
  if (!e) return "running…";
  const ms = new Date(e).getTime() - new Date(s).getTime();
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
};

// ── Output files section ────────────────────────────────────────────────────
function OutputSection({ scriptId }: { scriptId: string }) {
  const [files, setFiles]     = useState<OutputFile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/scripts/${scriptId}/output`)
      .then(r => r.json())
      .then(d => { setFiles(d); setLoading(false); });
  }, [scriptId]);

  useEffect(() => { load(); }, [load]);

  const del = async (filename: string) => {
    await fetch(`/api/scripts/${scriptId}/output/${encodeURIComponent(filename)}`, { method: "DELETE" });
    load();
  };

  if (loading) return null;

  return (
    <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Output Files</p>
        <button onClick={load} className="text-[11px] text-gray-400 hover:text-gray-600">↻ Refresh</button>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-gray-400">
          No output files yet. Scripts write to{" "}
          <code className="bg-gray-100 dark:bg-neutral-800 px-1 rounded">$SCRIPT_OUTPUT_DIR</code>.
        </p>
      ) : (
        files.map(f => (
          <div key={f.filename} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-neutral-800 last:border-0">
            <div>
              <span className="text-xs font-mono">{f.filename}</span>
              <span className="text-[10px] text-gray-400 ml-2">{(f.size / 1024).toFixed(1)} KB</span>
              <span className="text-[10px] text-gray-400 ml-2">{new Date(f.modified).toLocaleString()}</span>
            </div>
            <div className="flex gap-1.5">
              <a
                href={`/api/scripts/${scriptId}/output/${encodeURIComponent(f.filename)}`}
                download
                className="text-xs border border-gray-200 dark:border-neutral-700 px-2 py-0.5 rounded"
              >
                ⬇
              </a>
              <button
                onClick={() => del(f.filename)}
                className="text-xs text-red-400 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded"
              >
                ✕
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

// ── Code editor section ─────────────────────────────────────────────────────
function CodeEditor({ scriptId }: { scriptId: string }) {
  const [code, setCode]         = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState("");
  const textareaRef             = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`/api/scripts/${scriptId}/code`)
      .then(r => r.json())
      .then(d => setCode(d.code));
  }, [scriptId]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [code]);

  const save = async () => {
    if (code === null) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch(`/api/scripts/${scriptId}/code`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+S to save
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      save();
    }
    // Tab inserts spaces instead of changing focus
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const next  = code!.substring(0, start) + "    " + code!.substring(end);
      setCode(next);
      window.requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 4;
      });
    }
  };

  if (code === null) return (
    <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
      <p className="text-xs text-gray-400">Loading code…</p>
    </section>
  );

  return (
    <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Code Editor</p>
        <span className="text-[10px] text-gray-400">Ctrl+S / ⌘S to save · Tab inserts spaces</span>
      </div>

      <textarea
        ref={textareaRef}
        value={code}
        onChange={e => setCode(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className="w-full font-mono text-xs bg-gray-50 dark:bg-neutral-950 border border-gray-200 dark:border-neutral-700
          rounded px-3 py-2.5 resize-none leading-relaxed text-gray-800 dark:text-gray-200
          focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[200px]"
        style={{ overflow: "hidden" }}
      />

      {error && (
        <p className="mt-2 text-xs text-red-500">{error}</p>
      )}

      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={save}
          disabled={saving}
          className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-xs text-green-500">✓ Saved</span>}
      </div>
    </section>
  );
}

// ── Requirements editor ─────────────────────────────────────────────────────
function RequirementsEditor({ scriptId, onReinstallStarted }: {
  scriptId: string;
  onReinstallStarted: () => void;
}) {
  const [reqs, setReqs]         = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [installing, setInstalling] = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState("");
  const textareaRef             = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch(`/api/scripts/${scriptId}/requirements`)
      .then(r => r.json())
      .then(d => setReqs(d.requirements));
  }, [scriptId]);

  // Auto-resize
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(ta.scrollHeight, 80)}px`;
  }, [reqs]);

  const saveOnly = async () => {
    if (reqs === null) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch(`/api/scripts/${scriptId}/requirements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements: reqs }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  };

  const saveAndReinstall = async () => {
    if (reqs === null) return;
    setInstalling(true); setError("");
    try {
      const res = await fetch(`/api/scripts/${scriptId}/requirements/reinstall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements: reqs }),
      });
      if (!res.ok) throw new Error(await res.text());
      onReinstallStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setInstalling(false); }
  };

  if (reqs === null) return (
    <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
      <p className="text-xs text-gray-400">Loading requirements…</p>
    </section>
  );

  return (
    <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Requirements
          <span className="ml-2 font-normal normal-case text-gray-400">requirements.txt</span>
        </p>
        <span className="text-[10px] text-gray-400">one package per line</span>
      </div>

      <textarea
        ref={textareaRef}
        value={reqs}
        onChange={e => setReqs(e.target.value)}
        spellCheck={false}
        placeholder={"requests\npandas>=2.0\nnumpy"}
        className="w-full font-mono text-xs bg-gray-50 dark:bg-neutral-950 border border-gray-200 dark:border-neutral-700
          rounded px-3 py-2.5 resize-none leading-relaxed text-gray-800 dark:text-gray-200
          focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[80px]"
        style={{ overflow: "hidden" }}
      />

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={saveOnly}
          disabled={saving || installing}
          className="text-xs border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={saveAndReinstall}
          disabled={saving || installing}
          className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded disabled:opacity-50"
        >
          {installing ? "Reinstalling…" : "Save & Reinstall"}
        </button>
        {saved && <span className="text-xs text-green-500">✓ Saved</span>}
        <span className="text-[10px] text-gray-400 ml-auto">Reinstall rebuilds the venv with updated packages</span>
      </div>
    </section>
  );
}

// ── Main detail page ────────────────────────────────────────────────────────
export default function ScriptDetail() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();

  const [script, setScript]       = useState<Script | null>(null);
  const [name, setName]           = useState("");
  const [desc, setDesc]           = useState("");
  const [loopInterval, setLoopInterval] = useState("");
  const [saving, setSaving]       = useState(false);
  const [busy, setBusy]           = useState(false);
  const [confirm, setConfirm]     = useState(false);
  const [showLoopInput, setShowLoopInput] = useState(false);
  const [error, setError]         = useState("");

  const fetchScript = useCallback(() => {
    fetch(`/api/scripts/${id}`)
      .then(r => r.json())
      .then(d => {
        setScript(d);
        setName(d.name);
        setDesc(d.description ?? "");
        setLoopInterval(d.loop_interval ?? "1h");
      });
  }, [id]);

  useEffect(() => { fetchScript(); }, [fetchScript]);

  // Poll every 3s while a run is active
  useEffect(() => {
    if (!script) return;
    if (script.status !== "running") return;
    const t = window.setInterval(fetchScript, 3000);
    return () => window.clearInterval(t);
  }, [script?.status, fetchScript]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/scripts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: desc }),
      });
      if (!res.ok) throw new Error(await res.text());
      fetchScript();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/scripts/${id}/run`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      fetchScript();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true); setError("");
    try {
      await fetch(`/api/scripts/${id}/stop`, { method: "POST" });
      fetchScript();
    } finally { setBusy(false); }
  };

  const startLoop = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/scripts/${id}/loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval: loopInterval }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowLoopInput(false);
      fetchScript();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const byDate = script?.runs.reduce<Record<string, Run[]>>((acc, r) => {
    const d = r.started_at.slice(0, 10);
    (acc[d] ??= []).push(r);
    return acc;
  }, {}) ?? {};

  if (!script) return <div className="p-8 text-sm text-gray-400">Loading…</div>;

  const isActive = script.status === "running" || script.loop_enabled;

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto">
      <Link href="/" className="text-xs text-gray-400 hover:underline mb-4 block">← Back to dashboard</Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-base font-semibold mb-0.5">{script.name}</h1>
          <p className="text-xs text-gray-400 font-mono">{script.filename}</p>
        </div>

        {/* Run controls */}
        <div className="flex gap-1.5 shrink-0">
          {!isActive ? (
            <>
              <button
                disabled={busy}
                onClick={run}
                className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded font-medium disabled:opacity-50"
              >
                {busy ? "…" : "▶ Run"}
              </button>
              <button
                disabled={busy}
                onClick={() => setShowLoopInput(v => !v)}
                className="text-xs border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded font-medium"
              >
                🔁 Loop
              </button>
            </>
          ) : (
            <button
              disabled={busy}
              onClick={stop}
              className="text-xs bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded font-medium disabled:opacity-50"
            >
              {busy ? "…" : "■ Stop"}
            </button>
          )}
        </div>
      </div>

      {/* Loop interval input */}
      {showLoopInput && !isActive && (
        <div className="flex gap-2 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <input
            className="flex-1 text-xs border border-gray-300 dark:border-neutral-700 rounded px-2 py-1 bg-white dark:bg-neutral-900"
            value={loopInterval}
            onChange={e => setLoopInterval(e.target.value)}
            placeholder="e.g. 6h, 30m, 5s, 1d"
            autoFocus
          />
          <button
            disabled={busy}
            onClick={startLoop}
            className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded disabled:opacity-50"
          >
            Start loop
          </button>
          <button onClick={() => setShowLoopInput(false)} className="text-xs text-gray-400">Cancel</button>
        </div>
      )}

      {isActive && script.loop_enabled && (
        <p className="text-xs text-amber-500 dark:text-amber-400 mb-4">
          🔁 Looping every {script.loop_interval} — click Stop to cancel
        </p>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-500">
          {error}
        </div>
      )}

      {/* Edit metadata section */}
      <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Edit</p>
        <input
          className="w-full text-sm border border-gray-200 dark:border-neutral-700 rounded px-3 py-1.5 mb-2 bg-transparent"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
        />
        <input
          className="w-full text-sm border border-gray-200 dark:border-neutral-700 rounded px-3 py-1.5 mb-3 bg-transparent"
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Description"
        />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={() => fetch(`/api/scripts/${id}/reinstall`, { method: "POST" })}
            className="text-xs border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded"
          >
            ♻ Reinstall deps
          </button>
        </div>
      </section>

      {/* Code editor */}
      <CodeEditor scriptId={id} />

      {/* Requirements editor */}
      <RequirementsEditor scriptId={id} onReinstallStarted={fetchScript} />

      {/* Output files */}
      <OutputSection scriptId={id} />

      {/* Log history */}
      <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Log History</p>
        {script.runs.length === 0 ? (
          <p className="text-xs text-gray-400">No runs yet.</p>
        ) : (
          Object.entries(byDate)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, runs]) => (
              <div key={date} className="mb-4 last:mb-0">
                <p className="text-xs font-semibold text-gray-500 mb-2">{date}</p>
                {runs.map(r => (
                  <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-neutral-800 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] font-semibold px-1.5 rounded-full ${
                        r.status === "success" ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                          : r.status === "error" ? "bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-blue-100 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400"
                      }`}>
                        {r.exit_code != null ? `exit ${r.exit_code}` : r.status}
                      </span>
                      <span className="text-xs font-mono text-gray-500">
                        {new Date(r.started_at).toLocaleTimeString()}
                      </span>
                      <span className="text-xs text-gray-400">{dur(r.started_at, r.finished_at)}</span>
                    </div>
                    <a
                      href={`/api/runs/${r.id}/log`}
                      download
                      className="text-xs border border-gray-200 dark:border-neutral-700 px-2 py-0.5 rounded"
                    >
                      ⬇ Log
                    </a>
                  </div>
                ))}
              </div>
            ))
        )}
      </section>

      {/* Danger zone */}
      <section className="border border-red-200 dark:border-red-900/40 rounded-lg p-4">
        <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">Danger Zone</p>
        {!confirm ? (
          <button
            onClick={() => setConfirm(true)}
            className="text-xs bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded"
          >
            Delete script &amp; all logs
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-xs text-red-400">Cannot be undone.</p>
            <button
              onClick={async () => {
                await fetch(`/api/scripts/${id}`, { method: "DELETE" });
                router.push("/");
              }}
              className="text-xs bg-red-500 text-white px-3 py-1.5 rounded"
            >
              Delete
            </button>
            <button onClick={() => setConfirm(false)} className="text-xs text-gray-400 px-2">Cancel</button>
          </div>
        )}
      </section>
    </div>
  );
}
