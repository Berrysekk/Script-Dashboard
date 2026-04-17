"use client";

import { useEffect, useMemo, useState, use } from "react";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import RowEditModal from "@/app/components/RowEditModal";
import SchemaEditModal from "@/app/components/SchemaEditModal";
import { confirmDialog } from "@/app/components/ConfirmDialog";
import Checkbox from "@/app/components/Checkbox";

type Column = {
  id: string;
  name: string;
  key: string;
  type: string;
  config: { options?: string[] } | null;
};

type Row = { id: string; values: Record<string, unknown>; position: number };

type Database = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  columns: Column[];
  rows: Row[];
};

type User = { id: string; username: string; role: string };

type SortState = { colKey: string; dir: "asc" | "desc" } | null;

const MUTED = "text-gray-400 dark:text-neutral-500";
const MONO_BADGE =
  "font-mono text-xs bg-gray-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-gray-600 dark:text-neutral-400";
const SELECT_BADGE =
  "inline-block text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded";

function renderCell(col: Column, value: unknown) {
  if (value === null || value === undefined) return <span className={MUTED}>—</span>;
  if (col.type === "boolean") return <Checkbox checked={Boolean(value)} size="sm" />;
  if (col.type === "secret") return <code className={MONO_BADGE}>••••••</code>;
  if (col.type === "long_text") {
    const s = String(value);
    return <span title={s}>{s.length > 50 ? s.slice(0, 50) + "…" : s}</span>;
  }
  if (col.type === "json")
    return <code className={MONO_BADGE}>{JSON.stringify(value).slice(0, 80)}</code>;
  if (col.type === "select") return <span className={SELECT_BADGE}>{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function compareValues(col: Column, a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined || a === "";
  const bNull = b === null || b === undefined || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (col.type === "number") return Number(a) - Number(b);
  if (col.type === "boolean") return Number(Boolean(a)) - Number(Boolean(b));
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

function matchesFilter(col: Column, value: unknown, filter: string): boolean {
  if (!filter) return true;
  if (col.type === "secret") return true;
  if (col.type === "boolean") {
    if (filter === "true") return Boolean(value) === true;
    if (filter === "false") return Boolean(value) === false;
    return true;
  }
  if (col.type === "select") {
    return String(value ?? "") === filter;
  }
  const haystack =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return haystack.toLowerCase().includes(filter.toLowerCase());
}

function SortIcon({ state }: { state: "asc" | "desc" | "off" }) {
  const active = state !== "off";
  return (
    <span
      className={`inline-flex flex-col text-[9px] leading-[9px] ${
        active ? "text-gray-700 dark:text-neutral-200" : "text-gray-300 dark:text-neutral-600"
      }`}
      aria-hidden
    >
      <span className={state === "desc" ? "opacity-30" : ""}>▲</span>
      <span className={state === "asc" ? "opacity-30" : ""}>▼</span>
    </span>
  );
}

export default function DatabaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [db, setDb] = useState<Database | null>(null);
  const [editingRow, setEditingRow] = useState<Row | "new" | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const isAdmin = user?.role === "admin";

  async function load() {
    const [meRes, dbRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch(`/api/databases/${id}`),
    ]);
    if (meRes.ok) setUser(await meRes.json());
    if (dbRes.ok) {
      const data: Database = await dbRes.json();
      setDb(data);
      setSort((prev) => {
        if (prev) return prev;
        const nameCol = data.columns.find((c) => c.key === "name" || c.name.toLowerCase() === "name");
        const firstTextCol = data.columns.find(
          (c) => c.type === "text" || c.type === "long_text"
        );
        const defaultCol = nameCol ?? firstTextCol;
        return defaultCol ? { colKey: defaultCol.key, dir: "asc" } : null;
      });
    } else if (dbRes.status === 403 || dbRes.status === 404) {
      window.location.href = "/databases";
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  function toggleSort(colKey: string) {
    setSort((prev) => {
      if (!prev || prev.colKey !== colKey) return { colKey, dir: "asc" };
      return { colKey, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  const visibleRows = useMemo(() => {
    if (!db) return [];
    const filtered = db.rows.filter((r) =>
      db.columns.every((c) => matchesFilter(c, r.values[c.key], filters[c.key] ?? ""))
    );
    if (!sort) return filtered;
    const col = db.columns.find((c) => c.key === sort.colKey);
    if (!col) return filtered;
    const sorted = [...filtered].sort((a, b) => compareValues(col, a.values[col.key], b.values[col.key]));
    if (sort.dir === "desc") sorted.reverse();
    return sorted;
  }, [db, sort, filters]);

  async function saveRow(values: Record<string, unknown>) {
    const isNew = editingRow === "new";
    const url = isNew
      ? `/api/databases/${id}/rows`
      : `/api/databases/${id}/rows/${(editingRow as Row).id}`;
    const method = isNew ? "POST" : "PATCH";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });
    if (!res.ok) {
      const bodyText = await res.text();
      let payload: unknown = bodyText;
      try {
        const parsed = JSON.parse(bodyText);
        payload = parsed?.detail ?? parsed;
      } catch {
        // non-JSON body — keep raw text
      }
      throw new Error(typeof payload === "string" ? payload : JSON.stringify(payload));
    }
    setEditingRow(null);
    load();
  }

  async function deleteRow(r: Row) {
    const ok = await confirmDialog({ title: "Delete this row?" });
    if (!ok) return;
    await fetch(`/api/databases/${id}/rows/${r.id}`, { method: "DELETE" });
    load();
  }

  async function deleteDatabase() {
    const ok = await confirmDialog({
      title: `Delete database "${db?.name}"?`,
      message: "All rows and role grants for this database are removed.",
    });
    if (!ok) return;
    const res = await fetch(`/api/databases/${id}`, { method: "DELETE" });
    if (res.ok) window.location.href = "/databases";
  }

  if (!db) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-8 text-sm text-gray-500 dark:text-neutral-400">
        Loading…
      </div>
    );
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <Link
            href="/databases"
            className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200 transition-colors duration-100 mb-2"
          >
            <span>&larr;</span>
            <span>Back to databases</span>
          </Link>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{db.name}</h1>
            <code className="font-mono text-xs bg-gray-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-gray-500 dark:text-neutral-400">
              {db.slug}
            </code>
          </div>
          {db.description && (
            <p className="text-sm text-gray-600 dark:text-neutral-400 mt-1">
              {db.description}
            </p>
          )}
          <div className="text-xs text-gray-500 dark:text-neutral-400 mt-2">
            {visibleRows.length === db.rows.length
              ? `${db.rows.length} rows`
              : `${visibleRows.length} of ${db.rows.length} rows`}{" "}
            · {db.columns.length} columns
            {activeFilterCount > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => setFilters({})}
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  clear filters
                </button>
              </>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSchemaOpen(true)}
              className="text-sm px-3 py-1.5 border border-gray-200 dark:border-neutral-700 rounded text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors duration-100"
            >
              Edit schema
            </button>
            <button
              type="button"
              onClick={deleteDatabase}
              className="text-sm px-3 py-1.5 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-100"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-neutral-950/50 text-left text-xs text-gray-500 dark:text-neutral-400 border-b border-gray-200 dark:border-neutral-800">
              <tr>
                {db.columns.map((c) => {
                  const sortState: "asc" | "desc" | "off" =
                    sort?.colKey === c.key ? sort.dir : "off";
                  return (
                    <th key={c.id} className="py-2 px-3 font-medium whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        title={`Click to sort by ${c.name}`}
                        className="group inline-flex items-center gap-1.5 text-left hover:text-gray-900 dark:hover:text-neutral-100 transition-colors duration-100 cursor-pointer"
                      >
                        <span className="text-gray-700 dark:text-neutral-300">{c.name}</span>
                        <span className="text-[11px] text-gray-400 dark:text-neutral-500 font-normal">
                          {c.type}
                        </span>
                        <SortIcon state={sortState} />
                      </button>
                    </th>
                  );
                })}
                {isAdmin && <th className="py-2 px-3 w-16"></th>}
              </tr>
              {/* Filter row */}
              <tr className="bg-white dark:bg-neutral-900 border-t border-gray-100 dark:border-neutral-800/60">
                {db.columns.map((c) => (
                  <th key={c.id} className="py-1.5 px-3 font-normal">
                    <FilterInput
                      column={c}
                      value={filters[c.key] ?? ""}
                      onChange={(v) =>
                        setFilters((f) => ({ ...f, [c.key]: v }))
                      }
                    />
                  </th>
                ))}
                {isAdmin && <th className="py-1.5 px-3"></th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td
                    colSpan={db.columns.length + (isAdmin ? 1 : 0)}
                    className="py-6 px-3 text-center text-sm text-gray-500 dark:text-neutral-400"
                  >
                    {db.rows.length === 0
                      ? `No rows yet.${isAdmin ? ' Click "Add row" below.' : ""}`
                      : "No rows match the current filters."}
                  </td>
                </tr>
              )}
              {visibleRows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setEditingRow(r)}
                  className="border-t border-gray-100 dark:border-neutral-800/60 hover:bg-gray-50 dark:hover:bg-neutral-800/40 cursor-pointer transition-colors duration-100"
                >
                  {db.columns.map((c) => (
                    <td key={c.id} className="py-2 px-3 align-top">
                      {renderCell(c, r.values[c.key])}
                    </td>
                  ))}
                  {isAdmin && (
                    <td className="py-2 px-3 text-right align-top">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRow(r);
                        }}
                        className="text-xs px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-100"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add row button */}
      {isAdmin && (
        <button
          type="button"
          onClick={() => setEditingRow("new")}
          className="mt-4 text-sm px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
        >
          Add row
        </button>
      )}

      {/* Modals */}
      <AnimatePresence>
        {editingRow !== null && (
          <RowEditModal
            key="row-edit-modal"
            columns={db.columns}
            initial={editingRow === "new" ? undefined : editingRow.values}
            isReadOnly={!isAdmin}
            onCancel={() => setEditingRow(null)}
            onSave={saveRow}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {schemaOpen && (
          <SchemaEditModal
            key="schema-edit-modal"
            databaseId={id}
            columns={db.columns}
            onClose={() => setSchemaOpen(false)}
            onChanged={load}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterInput({
  column,
  value,
  onChange,
}: {
  column: Column;
  value: string;
  onChange: (v: string) => void;
}) {
  const baseInput =
    "w-full text-xs px-2 py-1 rounded border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-gray-700 dark:text-neutral-300 placeholder:text-gray-400 dark:placeholder:text-neutral-600 focus:outline-none focus:border-gray-400 dark:focus:border-neutral-500 transition-colors duration-100";

  if (column.type === "secret") {
    return <span className="text-[11px] text-gray-300 dark:text-neutral-700">—</span>;
  }
  if (column.type === "boolean") {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={baseInput}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">any</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (column.type === "select") {
    const opts = column.config?.options ?? [];
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={baseInput}
        onClick={(e) => e.stopPropagation()}
      >
        <option value="">any</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="filter…"
      className={baseInput}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
