"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../components/AuthGate";

type UserRow = {
  id: string;
  username: string;
  role: string;
  created_at?: string;
};

type Role = {
  name: string;
  script_ids: string[];
  category_ids: string[];
};

type ScriptSummary = {
  id: string;
  name: string;
};

type CategoryNode = {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  children: CategoryNode[];
};

function CategoryCheckboxTree({
  nodes,
  selected,
  onToggle,
  depth = 0,
}: {
  nodes: CategoryNode[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const checked = selected.has(node.id);
        const hasChildren = node.children.length > 0;
        return (
          <div key={node.id}>
            <label
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer"
              style={{ paddingLeft: `${12 + depth * 16}px` }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(node.id)}
                className="rounded border-gray-300 dark:border-neutral-600"
              />
              <span className="text-xs">{node.name}</span>
              {hasChildren && (
                <span className="text-[10px] text-gray-400 ml-auto">
                  {node.children.length} sub
                </span>
              )}
            </label>
            {hasChildren && (
              <CategoryCheckboxTree
                nodes={node.children}
                selected={selected}
                onToggle={onToggle}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export default function UsersPage() {
  const { user } = useAuth();
  const [rows, setRows]         = useState<UserRow[]>([]);
  const [roles, setRoles]       = useState<Role[]>([]);
  const [scripts, setScripts]   = useState<ScriptSummary[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [loading, setLoading]   = useState(true);
  const [denied, setDenied]     = useState(false);
  const [error, setError]       = useState("");

  // User creation
  const [newName, setNewName]   = useState("");
  const [newPw, setNewPw]       = useState("");
  const [newRole, setNewRole]   = useState("user");
  const [creating, setCreating] = useState(false);

  // Role creation/editing
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [editingRole, setEditingRole]   = useState<string | null>(null);
  const [roleName, setRoleName]         = useState("");
  const [roleScripts, setRoleScripts]   = useState<Set<string>>(new Set());
  const [roleCategories, setRoleCategories] = useState<Set<string>>(new Set());
  const [savingRole, setSavingRole]     = useState(false);

  const loadAll = useCallback(async () => {
    setError("");
    const [usersRes, rolesRes, scriptsRes, catsRes] = await Promise.all([
      fetch("/api/auth/users"),
      fetch("/api/auth/roles"),
      fetch("/api/scripts"),
      fetch("/api/categories"),
    ]);
    if (usersRes.status === 403) {
      setDenied(true);
      setLoading(false);
      return;
    }
    if (!usersRes.ok) {
      setError(await usersRes.text());
      setLoading(false);
      return;
    }
    setRows(await usersRes.json());
    if (rolesRes.ok) setRoles(await rolesRes.json());
    if (scriptsRes.ok) setScripts(await scriptsRes.json());
    if (catsRes.ok) setCategories(await catsRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const createUser = async (e: React.FormEvent) => {
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
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setCreating(false); }
  };

  const removeUser = async (row: UserRow) => {
    if (!confirm(`Delete ${row.username}?`)) return;
    const res = await fetch(`/api/auth/users/${row.id}`, { method: "DELETE" });
    if (!res.ok) { setError(await res.text()); return; }
    loadAll();
  };

  const openCreateRole = () => {
    setEditingRole(null);
    setRoleName("");
    setRoleScripts(new Set());
    setRoleCategories(new Set());
    setShowRoleForm(true);
  };

  const openEditRole = (role: Role) => {
    setEditingRole(role.name);
    setRoleName(role.name);
    setRoleScripts(new Set(role.script_ids));
    setRoleCategories(new Set(role.category_ids));
    setShowRoleForm(true);
  };

  const saveRole = async () => {
    setSavingRole(true); setError("");
    try {
      if (editingRole) {
        const res = await fetch(`/api/auth/roles/${encodeURIComponent(editingRole)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ script_ids: [...roleScripts], category_ids: [...roleCategories] }),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await fetch("/api/auth/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: roleName, script_ids: [...roleScripts], category_ids: [...roleCategories] }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setShowRoleForm(false);
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setSavingRole(false); }
  };

  const deleteRole = async (name: string) => {
    if (!confirm(`Delete role "${name}"?`)) return;
    const res = await fetch(`/api/auth/roles/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) { setError(await res.text()); return; }
    loadAll();
  };

  const toggleScript = (id: string) => {
    setRoleScripts(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const collectDescendantIds = (node: CategoryNode): string[] => {
    const ids: string[] = [];
    for (const child of node.children) {
      ids.push(child.id);
      ids.push(...collectDescendantIds(child));
    }
    return ids;
  };

  const findNode = (nodes: CategoryNode[], id: string): CategoryNode | null => {
    for (const n of nodes) {
      if (n.id === id) return n;
      const found = findNode(n.children, id);
      if (found) return found;
    }
    return null;
  };

  const toggleCategory = (id: string) => {
    setRoleCategories(prev => {
      const next = new Set(prev);
      const node = findNode(categories, id);
      if (!node) return next;
      const descendants = collectDescendantIds(node);
      if (next.has(id)) {
        next.delete(id);
        for (const d of descendants) next.delete(d);
      } else {
        next.add(id);
        for (const d of descendants) next.add(d);
      }
      return next;
    });
  };

  if (denied) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-gray-400">
        <p>Admins only.</p>
        <Link href="/" className="text-blue-500">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <div className="p-5">
      <div className="max-w-3xl space-y-5">
        <h1 className="text-sm font-semibold">Users</h1>

        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-500">
            {error}
          </div>
        )}

        {/* ── Create user ── */}
        <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Create user</p>
          <form onSubmit={createUser} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Username</label>
                <input
                  className="w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="username"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  className="w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="password"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Role</label>
                <select
                  className="w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-2 py-1.5 bg-white dark:bg-neutral-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                >
                  {roles.map(r => (
                    <option key={r.name} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={creating || !newName || !newPw}
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-4 py-1.5 rounded font-medium disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create user"}
            </button>
          </form>
        </section>

        {/* ── User list ── */}
        <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            All users {rows.length > 0 && <span className="font-normal">({rows.length})</span>}
          </p>
          {loading ? (
            <p className="text-xs text-gray-400">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-gray-400">No users.</p>
          ) : (
            <div>
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-neutral-800 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-neutral-800 flex items-center justify-center text-xs font-semibold text-gray-500">
                      {r.username[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{r.username}</p>
                      <p className="text-[10px] text-gray-400">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold mr-1 ${
                          r.role === "admin"
                            ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                            : "bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-gray-400"
                        }`}>
                          {r.role}
                        </span>
                        {r.created_at && <span>{r.created_at}</span>}
                      </p>
                    </div>
                  </div>
                  <button
                    disabled={r.id === user?.id}
                    onClick={() => removeUser(r)}
                    title={r.id === user?.id ? "Can't delete yourself" : "Delete"}
                    className="text-xs text-red-400 border border-red-200 dark:border-red-800 px-2.5 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Roles ── */}
        <section className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Roles {roles.length > 0 && <span className="font-normal">({roles.length})</span>}
            </p>
            <button
              onClick={openCreateRole}
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded font-medium"
            >
              + New role
            </button>
          </div>

          {roles.map(r => {
            const isSystem = r.name === "admin" || r.name === "user";
            return (
              <div
                key={r.name}
                className="flex items-center justify-between py-2.5 border-b border-gray-100 dark:border-neutral-800 last:border-0"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    {isSystem && (
                      <span className="text-[9px] text-gray-400 border border-gray-200 dark:border-neutral-700 px-1.5 py-0.5 rounded">system</span>
                    )}
                  </div>
                  {!isSystem && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {r.script_ids.length === 0 && r.category_ids.length === 0
                        ? "No scripts or categories assigned"
                        : [
                            r.script_ids.length > 0 && `${r.script_ids.length} script${r.script_ids.length > 1 ? "s" : ""}`,
                            r.category_ids.length > 0 && `${r.category_ids.length} categor${r.category_ids.length > 1 ? "ies" : "y"}`,
                          ].filter(Boolean).join(", ") + " assigned"}
                    </p>
                  )}
                  {isSystem && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {r.name === "admin" ? "Full access to all scripts" : "Access to own scripts only"}
                    </p>
                  )}
                </div>
                {!isSystem && (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => openEditRole(r)}
                      className="text-xs border border-gray-200 dark:border-neutral-700 px-2.5 py-1 rounded hover:bg-gray-50 dark:hover:bg-neutral-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteRole(r.name)}
                      className="text-xs text-red-400 border border-red-200 dark:border-red-800 px-2.5 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* ── Role create/edit dialog ── */}
        {showRoleForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowRoleForm(false)}>
            <div
              className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-700 shadow-2xl w-full max-w-md mx-4 p-5"
              onClick={e => e.stopPropagation()}
            >
              <h2 className="text-sm font-semibold mb-4">
                {editingRole ? `Edit role: ${editingRole}` : "Create role"}
              </h2>

              {!editingRole && (
                <div className="mb-4">
                  <label className="block text-[10px] text-gray-400 mb-1">Role name</label>
                  <input
                    className="w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400"
                    value={roleName}
                    onChange={e => setRoleName(e.target.value)}
                    placeholder="e.g. viewer, operator"
                    autoFocus
                  />
                </div>
              )}

              <div className="mb-4">
                <label className="block text-[10px] text-gray-400 mb-2">Scripts this role can access</label>
                <div className="max-h-[300px] overflow-y-auto border border-gray-200 dark:border-neutral-700 rounded-lg divide-y divide-gray-100 dark:divide-neutral-800">
                  {scripts.length === 0 ? (
                    <p className="text-xs text-gray-400 p-3">No scripts available.</p>
                  ) : (
                    scripts.map(s => (
                      <label
                        key={s.id}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-neutral-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={roleScripts.has(s.id)}
                          onChange={() => toggleScript(s.id)}
                          className="rounded border-gray-300 dark:border-neutral-600"
                        />
                        <span className="text-xs">{s.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {categories.length > 0 && (
                <div className="mb-4">
                  <label className="block text-[10px] text-gray-400 mb-2">Categories this role can access</label>
                  <div className="max-h-[200px] overflow-y-auto border border-gray-200 dark:border-neutral-700 rounded-lg divide-y divide-gray-100 dark:divide-neutral-800">
                    <CategoryCheckboxTree
                      nodes={categories}
                      selected={roleCategories}
                      onToggle={toggleCategory}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Selecting a category grants access to all scripts in it and its subcategories.</p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={saveRole}
                  disabled={savingRole || (!editingRole && !roleName.trim())}
                  className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-4 py-1.5 rounded font-medium disabled:opacity-50"
                >
                  {savingRole ? "Saving..." : editingRole ? "Save changes" : "Create role"}
                </button>
                <button
                  onClick={() => setShowRoleForm(false)}
                  className="text-xs text-gray-400 px-3 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
