"use client";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import DatabaseCard, { Database } from "../components/DatabaseCard";
import { confirmDialog } from "../components/ConfirmDialog";

type User = { id: string; username: string; role: string };

type FormState = { name: string; slug: string; description: string };

type ApiError = { detail?: string | { error?: string; suggestion?: string } };

const emptyForm: FormState = { name: "", slug: "", description: "" };

export default function DatabasesPage() {
  const [user, setUser]       = useState<User | null>(null);
  const [dbs, setDbs]         = useState<Database[]>([]);
  const [form, setForm]       = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<Database | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const isAdmin = user?.role === "admin";

  const loadAll = useCallback(async () => {
    const [meRes, dbsRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/databases"),
    ]);
    if (meRes.ok) setUser(await meRes.json());
    if (dbsRes.ok) setDbs(await dbsRes.json());
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/databases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm(emptyForm);
      loadAll();
      return;
    }
    let j: ApiError | null = null;
    try { j = (await res.json()) as ApiError; } catch { j = null; }
    const detail = j?.detail;
    if (res.status === 409 && typeof detail === "object" && detail?.suggestion) {
      setError(`ID taken. Suggestion: ${detail.suggestion}`);
    } else {
      setError(typeof detail === "string" ? detail : "Create failed");
    }
  };

  const handleDelete = async (db: Database) => {
    const ok = await confirmDialog({
      title: `Delete database "${db.name}"?`,
      message: "All rows and role grants for this database are removed.",
    });
    if (!ok) return;
    setError(null);
    const res = await fetch(`/api/databases/${db.id}`, { method: "DELETE" });
    if (res.ok) {
      loadAll();
      return;
    }
    let j: ApiError | null = null;
    try { j = (await res.json()) as ApiError; } catch { j = null; }
    setError(typeof j?.detail === "string" ? j.detail : "Delete failed");
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const res = await fetch(`/api/databases/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name,
        slug: editing.slug,
        description: editing.description,
      }),
    });
    if (res.ok) {
      setEditing(null);
      loadAll();
      return;
    }
    let j: ApiError | null = null;
    try { j = (await res.json()) as ApiError; } catch { j = null; }
    const detail = j?.detail;
    if (res.status === 409 && typeof detail === "object" && detail?.suggestion) {
      setError(`ID taken. Suggestion: ${detail.suggestion}`);
    } else {
      setError(typeof detail === "string" ? detail : "Save failed");
    }
  };

  const inputCls =
    "w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-2 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-900 dark:text-neutral-100 placeholder:text-gray-400 dark:placeholder:text-neutral-500";

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-6">Databases</h1>

      {isAdmin && (
        <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl p-4 mb-6">
          <form onSubmit={handleCreate} className="flex flex-wrap gap-2 items-end">
            <input
              className={`${inputCls} flex-1 min-w-32`}
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              className={`${inputCls} flex-1 min-w-32`}
              placeholder="ID (optional)"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
            <input
              className={`${inputCls} flex-[2] min-w-48`}
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <button
              type="submit"
              className="text-sm px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100 whitespace-nowrap"
            >
              Create
            </button>
          </form>
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
          {error}
        </div>
      )}

      {dbs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-neutral-400">
          No databases yet.{isAdmin && " Create one above."}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dbs.map((db) => (
            <DatabaseCard
              key={db.id}
              db={db}
              isAdmin={isAdmin}
              onEdit={() => { setError(null); setEditing(db); }}
              onDelete={() => handleDelete(db)}
            />
          ))}
        </div>
      )}

      {/* Edit modal */}
      <AnimatePresence>
        {editing && (
          <>
            <motion.div
              key="edit-db-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => setEditing(null)}
            />
            <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
              <motion.div
                key="edit-db-panel"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl p-6 w-full max-w-md shadow-xl pointer-events-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="font-semibold text-sm mb-4">Edit Database</h2>
                <form onSubmit={handleEditSave} className="flex flex-col gap-3">
                  <input
                    className={inputCls}
                    placeholder="Name"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    required
                  />
                  <input
                    className={inputCls}
                    placeholder="ID"
                    value={editing.slug}
                    onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                  />
                  <input
                    className={inputCls}
                    placeholder="Description (optional)"
                    value={editing.description ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, description: e.target.value || null })
                    }
                  />
                  {error && (
                    <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
                      {error}
                    </div>
                  )}
                  <div className="flex gap-2 justify-end mt-1">
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="text-sm px-4 py-1.5 border border-gray-200 dark:border-neutral-700 rounded text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors duration-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors duration-100"
                    >
                      Save
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
