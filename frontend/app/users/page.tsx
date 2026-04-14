"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../components/AuthGate";

type UserRow = {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at?: string;
};

export default function UsersPage() {
  const { user } = useAuth();
  const [rows, setRows]         = useState<UserRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [denied, setDenied]     = useState(false);
  const [error, setError]       = useState("");

  const [newName, setNewName]   = useState("");
  const [newPw, setNewPw]       = useState("");
  const [newRole, setNewRole]   = useState<"admin" | "user">("user");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/auth/users");
    if (res.status === 403) {
      setDenied(true);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError(await res.text());
      setLoading(false);
      return;
    }
    setRows(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true); setError("");
    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newName, password: newPw, role: newRole }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewName(""); setNewPw(""); setNewRole("user");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setCreating(false); }
  };

  const remove = async (row: UserRow) => {
    if (!confirm(`Delete ${row.username}?`)) return;
    const res = await fetch(`/api/auth/users/${row.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    load();
  };

  if (denied) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-gray-400">
        <p>Admins only.</p>
        <Link href="/" className="text-blue-500">← Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-sm font-semibold">Users</h1>
        </div>

        <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4 mb-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Create user
          </p>
          <form onSubmit={create} className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] text-gray-400 mb-1">Username</label>
              <input
                className="w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-1.5 bg-transparent"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] text-gray-400 mb-1">Password</label>
              <input
                type="password"
                className="w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-1.5 bg-transparent"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 mb-1">Role</label>
              <select
                className="text-sm border border-gray-300 dark:border-neutral-700 rounded px-2 py-1.5 bg-white dark:bg-neutral-900"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={creating || !newName || !newPw}
              className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </form>
        </section>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-500">
            {error}
          </div>
        )}

        <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            All users {rows.length > 0 && <span className="font-normal">({rows.length})</span>}
          </p>
          {loading ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-gray-400">No users.</p>
          ) : (
            <div>
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-neutral-800 last:border-0"
                >
                  <div>
                    <p className="text-sm">{r.username}</p>
                    <p className="text-[10px] text-gray-400">
                      {r.role}{r.created_at ? ` · ${r.created_at}` : ""}
                    </p>
                  </div>
                  <button
                    disabled={r.id === user?.id}
                    onClick={() => remove(r)}
                    title={r.id === user?.id ? "Can't delete yourself" : "Delete"}
                    className="text-xs text-red-400 border border-red-200 dark:border-red-800 px-2 py-1 rounded disabled:opacity-30"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
