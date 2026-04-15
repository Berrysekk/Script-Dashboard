"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import LoopPicker, { formatLoopInterval } from "../../components/LoopPicker";
import LogDrawer from "../../components/LogDrawer";
import { motion, AnimatePresence } from "motion/react";

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
/** Encode a posix path for use in a URL, preserving real slashes between segments */
function encodeOutputPath(p: string) {
  return p.split("/").map(encodeURIComponent).join("/");
}

const TEXT_EXTS = new Set([
  "txt","log","csv","json","xml","rsc","py","sh","js","ts","md",
  "yaml","yml","toml","ini","cfg","conf","html","css","sql","env",
]);
const IMAGE_EXTS = new Set(["png","jpg","jpeg","gif","svg","webp","bmp","ico"]);

function FilePreview({ scriptId, filename, onClose }: {
  scriptId: string; filename: string; onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const isImage = IMAGE_EXTS.has(ext);
  const isHtml = ext === "html" || ext === "htm";
  const isText = !isHtml && TEXT_EXTS.has(ext);
  const url = `/api/scripts/${scriptId}/output/${encodeOutputPath(filename)}`;

  useEffect(() => {
    if (isText) {
      fetch(url)
        .then(r => r.text())
        .then(t => { setContent(t); setLoading(false); });
    } else if (!isHtml) {
      setLoading(false);
    }
  }, [url, isText, isHtml]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    />
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 500, damping: 35 }}
      className="fixed inset-0 z-50 flex flex-col pointer-events-none"
    >
      <div
        className="flex-1 flex flex-col m-4 bg-white dark:bg-neutral-900 rounded-xl overflow-hidden shadow-2xl pointer-events-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-neutral-700 shrink-0">
          <span className="text-sm font-mono text-gray-600 dark:text-gray-300 truncate">{filename}</span>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href={url}
              download={filename.split("/").at(-1)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border border-gray-200 dark:border-neutral-700 px-2.5 py-1 rounded"
            >
              Download
            </a>
            <button
              onClick={onClose}
              className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-medium px-2"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isHtml && (
            <iframe
              src={`${url}?inline=1`}
              title={filename}
              className={`w-full h-full border-0 bg-white ${loading ? "invisible" : ""}`}
              sandbox="allow-scripts"
              onLoad={() => setLoading(false)}
            />
          )}
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-400">Loading...</p>
            </div>
          ) : isImage ? (
            <div className="flex items-center justify-center h-full p-6 bg-neutral-100 dark:bg-neutral-950">
              <img src={`${url}?inline=1`} alt={filename} className="max-w-full max-h-full object-contain rounded" />
            </div>
          ) : isText && content !== null ? (
            <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words p-5 leading-relaxed">{content}</pre>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-400">Preview not available for .{ext} files.</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
    </>
  );
}

function OutputSection({ scriptId }: { scriptId: string }) {
  const [files, setFiles]           = useState<OutputFile[]>([]);
  const [loading, setLoading]       = useState(true);
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/scripts/${scriptId}/output`)
      .then(r => r.json())
      .then(d => { setFiles(d); setLoading(false); });
  }, [scriptId]);

  useEffect(() => { load(); }, [load]);

  const del = async (filename: string) => {
    await fetch(`/api/scripts/${scriptId}/output/${encodeOutputPath(filename)}`, { method: "DELETE" });
    load();
  };

  const toggleDir = (dir: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      return next;
    });

  if (loading) return null;

  // Group files by their immediate parent directory ("" = root)
  const groups: Record<string, OutputFile[]> = {};
  for (const f of files) {
    const parts = f.filename.split("/");
    const dir   = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    (groups[dir] ??= []).push(f);
  }
  const dirs = Object.keys(groups).sort();

  return (
    <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Output Files
          {files.length > 0 && <span className="ml-2 font-normal text-gray-400">({files.length})</span>}
        </p>
        <button onClick={load} className="text-[11px] text-gray-400 hover:text-gray-600">↻ Refresh</button>
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-gray-400">
          No output files yet. Scripts write to{" "}
          <code className="bg-gray-100 dark:bg-neutral-800 px-1 rounded">$SCRIPT_OUTPUT_DIR</code>.
        </p>
      ) : (
        dirs.map(dir => {
          const dirFiles  = groups[dir];
          const isCollapsed = collapsed.has(dir);
          const label     = dir || "📁 /";
          return (
            <div key={dir || "__root__"} className="mb-3 last:mb-0">
              {/* Directory header — only shown for subdirectories */}
              {dir && (
                <button
                  onClick={() => toggleDir(dir)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400
                    w-full text-left py-1 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  <span>{isCollapsed ? "▶" : "▼"}</span>
                  <span className="font-mono">📁 {label}</span>
                  <span className="text-gray-400 font-normal">({dirFiles.length})</span>
                </button>
              )}
              {/* File rows */}
              {!isCollapsed && [...dirFiles].sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()).map(f => {
                const basename = f.filename.split("/").at(-1)!;
                const url      = `/api/scripts/${scriptId}/output/${encodeOutputPath(f.filename)}`;
                return (
                  <div key={f.filename} className={`border-b border-gray-100 dark:border-neutral-800 last:border-0 ${dir ? "pl-4" : ""}`}>
                    <div className="flex items-center justify-between py-1.5">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-mono truncate block">{basename}</span>
                        <span className="text-[10px] text-gray-400">
                          {(f.size / 1024).toFixed(1)} KB · {new Date(f.modified).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex gap-1.5 shrink-0 ml-3">
                        <button
                          onClick={() => setPreviewFile(previewFile === f.filename ? null : f.filename)}
                          className={`text-xs border px-2 py-0.5 rounded ${
                            previewFile === f.filename
                              ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-500"
                              : "border-gray-200 dark:border-neutral-700 text-gray-400 hover:text-gray-600"
                          }`}
                          title="Preview"
                        >
                          Preview
                        </button>
                        <a
                          href={url}
                          download={basename}
                          className="text-xs border border-gray-200 dark:border-neutral-700 px-2 py-0.5 rounded"
                        >
                          Download
                        </a>
                        <button
                          onClick={() => del(f.filename)}
                          className="text-xs text-red-400 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <AnimatePresence>
                      {previewFile === f.filename && (
                        <FilePreview
                          scriptId={scriptId}
                          filename={f.filename}
                          onClose={() => setPreviewFile(null)}
                        />
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </section>
  );
}

// ── Code editor section ─────────────────────────────────────────────────────
// Lazy-load CodeMirror to avoid SSR issues
import dynamic from "next/dynamic";
const CodeMirrorEditor = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });

function CodeEditor({ scriptId }: { scriptId: string }) {
  const [code, setCode]         = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState("");
  const [collapsed, setCollapsed] = useState(true);
  const [extensions, setExtensions] = useState<any[]>([]);
  const codeRef                 = useRef<string>("");
  const saveRef                 = useRef<() => void>(() => {});

  useEffect(() => {
    fetch(`/api/scripts/${scriptId}/code`)
      .then(r => r.json())
      .then(d => { setCode(d.code); codeRef.current = d.code; });
  }, [scriptId]);

  // Load CodeMirror extensions (python + Ctrl+S keymap + theme overrides) client-side only
  useEffect(() => {
    Promise.all([
      import("@codemirror/lang-python"),
      import("@codemirror/view"),
    ]).then(([{ python }, { keymap, EditorView }]) => {
      const themeOverride = EditorView.theme({
        "&": { backgroundColor: "transparent" },
        ".cm-gutters": { backgroundColor: "transparent", borderRight: "1px solid var(--cm-gutter-border, #e5e7eb)" },
      });
      setExtensions([
        python(),
        themeOverride,
        keymap.of([{
          key: "Mod-s",
          run: () => { saveRef.current(); return true; },
        }]),
      ]);
    });
  }, []);

  const save = async () => {
    const c = codeRef.current;
    if (c === null) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const res = await fetch(`/api/scripts/${scriptId}/code`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
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

  saveRef.current = save;

  const isDark = typeof window !== "undefined" && document.documentElement.classList.contains("dark");

  if (code === null) return (
    <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
      <p className="text-xs text-gray-400">Loading code...</p>
    </section>
  );

  return (
    <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center justify-between w-full"
      >
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <span className="text-[10px]">{collapsed ? "▶" : "▼"}</span>
          Code Editor
        </p>
        {!collapsed && <span className="text-[10px] text-gray-400">Ctrl+S / Cmd+S to save</span>}
      </button>

      {!collapsed && (
        <>
          <div className="mt-3 border border-gray-200 dark:border-neutral-700 rounded overflow-hidden bg-gray-50 dark:bg-neutral-950">
            <CodeMirrorEditor
              value={code}
              onChange={(val) => { setCode(val); codeRef.current = val; }}
              extensions={extensions}
              theme={isDark ? "dark" : "light"}
              height="500px"
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                bracketMatching: true,
                indentOnInput: true,
                tabSize: 4,
              }}
            />
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-500">{error}</p>
          )}

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={save}
              disabled={saving}
              className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {saved && <span className="text-xs text-green-500">Saved</span>}
          </div>
        </>
      )}
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
        placeholder="one package per line"
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
  const [saving, setSaving]       = useState(false);
  const [busy, setBusy]           = useState(false);
  const [confirm, setConfirm]     = useState(false);
  const [showLoopInput, setShowLoopInput] = useState(false);
  const [error, setError]         = useState("");
  const [logRunId, setLogRunId]   = useState<string | null>(null);

  const fetchScript = useCallback(() => {
    fetch(`/api/scripts/${id}`)
      .then(r => r.json())
      .then(d => {
        setScript(d);
        setName(d.name);
        setDesc(d.description ?? "");
      });
  }, [id]);

  useEffect(() => { setScript(null); fetchScript(); }, [fetchScript]);

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

  const startLoop = async (interval: string) => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/scripts/${id}/loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
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

  if (!script) return (
    <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div>
  );

  const isActive = script.status === "running" || script.loop_enabled;

  const statusBadge = script.loop_enabled
    ? { label: "● Looping", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" }
    : script.status === "running"
    ? { label: "● Running",  cls: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" }
    : script.status === "success"
    ? { label: "✓ Success",  cls: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400" }
    : script.status === "warning"
    ? { label: "⚠ Warning",  cls: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" }
    : script.status === "error"
    ? { label: "✕ Error",    cls: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" }
    : { label: "Idle",       cls: "bg-gray-100 text-gray-400 dark:bg-neutral-800 dark:text-gray-500" };

  return (
    <div>
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-800 px-6 py-3 flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-sm font-semibold truncate">{script.name}</h1>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
            {isActive && script.loop_enabled && script.loop_interval && (
              <span className="text-[10px] text-amber-500 dark:text-amber-400">{formatLoopInterval(script.loop_interval)}</span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 font-mono truncate mt-0.5">{script.filename}</p>
        </div>

        {/* Run controls */}
        <div className="flex gap-1.5 shrink-0">
          {!isActive ? (
            <>
              <button
                disabled={busy}
                onClick={run}
                className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-4 py-1.5 rounded font-medium disabled:opacity-50"
              >
                {busy ? "…" : "▶ Run"}
              </button>
              <button
                disabled={busy}
                onClick={() => setShowLoopInput(v => !v)}
                className="text-xs border border-gray-200 dark:border-neutral-700 hover:bg-gray-50 dark:hover:bg-neutral-800 px-3 py-1.5 rounded font-medium"
              >
                Loop
              </button>
            </>
          ) : (
            <button
              disabled={busy}
              onClick={stop}
              className="text-xs bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-800 hover:bg-red-100 px-4 py-1.5 rounded font-medium disabled:opacity-50"
            >
              {busy ? "…" : "■ Stop"}
            </button>
          )}
        </div>
      </div>

      {/* Loop picker */}
      {showLoopInput && !isActive && (
        <div className="mx-6 mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <LoopPicker
            disabled={busy}
            onSelect={(interval) => startLoop(interval)}
            onCancel={() => setShowLoopInput(false)}
          />
        </div>
      )}

      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-500">
          {error}
        </div>
      )}

      {/* Two-column body */}
      <div className="p-6 grid grid-cols-[1fr_340px] gap-5 items-start">

        {/* ── LEFT: code + requirements + output ── */}
        <div className="min-w-0 space-y-4">
          <CodeEditor scriptId={id} />
          <RequirementsEditor scriptId={id} onReinstallStarted={fetchScript} />
          <OutputSection scriptId={id} />
        </div>

        {/* ── RIGHT: metadata + log history + danger ── */}
        <div className="space-y-4">

          {/* Metadata */}
          <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Details</p>
            <label className="block text-[10px] text-gray-400 mb-1">Name</label>
            <input
              className="w-full text-sm border border-gray-200 dark:border-neutral-700 rounded px-3 py-1.5 mb-3 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Script name"
            />
            <label className="block text-[10px] text-gray-400 mb-1">Description</label>
            <input
              className="w-full text-sm border border-gray-200 dark:border-neutral-700 rounded px-3 py-1.5 mb-4 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional description"
            />
            <button
              onClick={save}
              disabled={saving}
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </section>

          {/* Log history */}
          <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Run History
              {script.runs.length > 0 && <span className="ml-2 font-normal">({script.runs.length})</span>}
            </p>
            {script.runs.length === 0 ? (
              <p className="text-xs text-gray-400">No runs yet.</p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto -mx-4 px-4">
                {Object.entries(byDate)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([date, runs]) => (
                    <div key={date} className="mb-3 last:mb-0">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{date}</p>
                      {[...runs].sort((a, b) => b.started_at.localeCompare(a.started_at)).map(r => (
                        <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-neutral-800 last:border-0 gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                              r.status === "success" ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                                : r.status === "warning" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                                : r.status === "error"   ? "bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-blue-100 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400"
                            }`}>
                              {r.exit_code != null ? `exit ${r.exit_code}` : r.status}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[11px] font-mono text-gray-500 truncate">
                                {new Date(r.started_at).toLocaleTimeString()}
                              </p>
                              <p className="text-[10px] text-gray-400">{dur(r.started_at, r.finished_at)}</p>
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => setLogRunId(r.id)}
                              className="text-[10px] border border-gray-200 dark:border-neutral-700 px-2 py-0.5 rounded hover:bg-gray-50 dark:hover:bg-neutral-800"
                            >
                              Preview
                            </button>
                            <a
                              href={`/api/runs/${r.id}/log`}
                              download
                              className="text-[10px] border border-gray-200 dark:border-neutral-700 px-2 py-0.5 rounded hover:bg-gray-50 dark:hover:bg-neutral-800"
                            >
                              Log
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            )}
          </section>

          {/* Danger zone */}
          <section className="border border-red-200 dark:border-red-900/40 rounded-lg p-4">
            <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-3">Danger Zone</p>
            {!confirm ? (
              <button
                onClick={() => setConfirm(true)}
                className="text-xs bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-800 hover:bg-red-100 px-3 py-1.5 rounded"
              >
                Delete script &amp; all logs
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-red-400">Cannot be undone.</p>
                <button
                  onClick={async () => {
                    await fetch(`/api/scripts/${id}`, { method: "DELETE" });
                    window.dispatchEvent(new Event("scripts-changed"));
                    router.push("/");
                  }}
                  className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded"
                >
                  Delete
                </button>
                <button onClick={() => setConfirm(false)} className="text-xs text-gray-400 px-2">Cancel</button>
              </div>
            )}
          </section>

        </div>
      </div>

      <AnimatePresence>
        {logRunId && (
          <LogDrawer
            scriptId={id}
            scriptName={script.name}
            initialRunId={logRunId}
            onClose={() => setLogRunId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
