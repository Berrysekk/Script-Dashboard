"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

type Run = { id: string; started_at: string; finished_at?: string; exit_code?: number; status: string; };
type Script = { id: string; name: string; filename: string; description?: string; loop_enabled: boolean; loop_interval?: string; runs: Run[]; };
type OutputFile = { filename: string; size: number; modified: string; };

const dur = (s: string, e?: string) => !e ? "running…"
  : (new Date(e).getTime() - new Date(s).getTime()) < 60000
    ? `${((new Date(e).getTime() - new Date(s).getTime())/1000).toFixed(1)}s`
    : `${Math.floor((new Date(e).getTime()-new Date(s).getTime())/60000)}m`;

function OutputSection({ scriptId }: { scriptId: string }) {
  const [files, setFiles]     = useState<OutputFile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch(`/api/scripts/${scriptId}/output`)
      .then(r => r.json())
      .then(d => { setFiles(d); setLoading(false); });
  };

  useEffect(() => { load(); }, [scriptId]);

  const del = async (filename: string) => {
    await fetch(`/api/scripts/${scriptId}/output/${encodeURIComponent(filename)}`, { method: "DELETE" });
    load();
  };

  if (loading) return null;

  return (
    <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Output Files</p>
      {files.length === 0
        ? <p className="text-xs text-gray-400">No output files yet. Scripts write to <code className="bg-gray-100 dark:bg-neutral-800 px-1 rounded">$SCRIPT_OUTPUT_DIR</code>.</p>
        : files.map(f => (
            <div key={f.filename} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-neutral-800 last:border-0">
              <div>
                <span className="text-xs font-mono">{f.filename}</span>
                <span className="text-[10px] text-gray-400 ml-2">{(f.size / 1024).toFixed(1)} KB</span>
                <span className="text-[10px] text-gray-400 ml-2">{new Date(f.modified).toLocaleString()}</span>
              </div>
              <div className="flex gap-1.5">
                <a href={`/api/scripts/${scriptId}/output/${encodeURIComponent(f.filename)}`} download
                  className="text-xs border border-gray-200 dark:border-neutral-700 px-2 py-0.5 rounded">⬇</a>
                <button onClick={() => del(f.filename)}
                  className="text-xs text-red-400 border border-red-200 dark:border-red-800 px-2 py-0.5 rounded">✕</button>
              </div>
            </div>
          ))
      }
    </section>
  );
}

export default function ScriptDetail() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();
  const [script, setScript] = useState<Script | null>(null);
  const [name, setName]     = useState("");
  const [desc, setDesc]     = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    fetch(`/api/scripts/${id}`).then(r => r.json()).then(d => {
      setScript(d); setName(d.name); setDesc(d.description ?? "");
    });
  }, [id]);

  const save = async () => {
    setSaving(true);
    await fetch(`/api/scripts/${id}`, { method: "PATCH", headers: { "Content-Type":"application/json" }, body: JSON.stringify({ name, description: desc }) });
    setSaving(false);
  };

  const byDate = script?.runs.reduce<Record<string,Run[]>>((a,r) => {
    const d = r.started_at.slice(0,10); (a[d] ??= []).push(r); return a;
  }, {}) ?? {};

  if (!script) return <div className="p-8 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
      <Link href="/" className="text-xs text-gray-400 hover:underline mb-4 block">← Back</Link>
      <h1 className="text-base font-semibold mb-1">{script.name}</h1>
      <p className="text-xs text-gray-400 font-mono mb-6">{script.filename}</p>

      <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Edit</p>
        <input className="w-full text-sm border border-gray-200 dark:border-neutral-700 rounded px-3 py-1.5 mb-2 bg-transparent"
          value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
        <input className="w-full text-sm border border-gray-200 dark:border-neutral-700 rounded px-3 py-1.5 mb-3 bg-transparent"
          value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description" />
        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={() => fetch(`/api/scripts/${id}/reinstall`, {method:"POST"})}
            className="text-xs border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded">
            ♻ Reinstall deps
          </button>
        </div>
      </section>

      <OutputSection scriptId={id} />

      <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Log History</p>
        {Object.entries(byDate).sort(([a],[b]) => b.localeCompare(a)).map(([date, runs]) => (
          <div key={date} className="mb-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">{date}</p>
            {runs.map(r => (
              <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-neutral-800 last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-semibold px-1.5 rounded-full
                    ${r.status==="success" ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                      : r.status==="error" ? "bg-red-100 text-red-500"
                      : "bg-blue-100 text-blue-500"}`}>
                    {r.exit_code != null ? `exit ${r.exit_code}` : r.status}
                  </span>
                  <span className="text-xs font-mono text-gray-500">{new Date(r.started_at).toLocaleTimeString()}</span>
                  <span className="text-xs text-gray-400">{dur(r.started_at, r.finished_at)}</span>
                </div>
                <a href={`/api/runs/${r.id}/log`} download
                  className="text-xs border border-gray-200 dark:border-neutral-700 px-2 py-0.5 rounded">⬇ Log</a>
              </div>
            ))}
          </div>
        ))}
        {script.runs.length === 0 && <p className="text-xs text-gray-400">No runs yet.</p>}
      </section>

      <section className="border border-red-200 dark:border-red-900/40 rounded-lg p-4">
        <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">Danger Zone</p>
        {!confirm
          ? <button onClick={() => setConfirm(true)}
              className="text-xs bg-red-50 dark:bg-red-900/20 text-red-500 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded">
              Delete script & all logs
            </button>
          : <div className="flex items-center gap-2">
              <p className="text-xs text-red-400">Cannot be undone.</p>
              <button onClick={async () => { await fetch(`/api/scripts/${id}`,{method:"DELETE"}); router.push("/"); }}
                className="text-xs bg-red-500 text-white px-3 py-1.5 rounded">Delete</button>
              <button onClick={() => setConfirm(false)} className="text-xs text-gray-400 px-2">Cancel</button>
            </div>
        }
      </section>
    </div>
  );
}
