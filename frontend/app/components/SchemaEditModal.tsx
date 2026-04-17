"use client";

import { Fragment, useState } from "react";
import { motion } from "motion/react";
import { confirmDialog } from "./ConfirmDialog";

type Column = {
  id: string;
  name: string;
  key: string;
  type: string;
  config: { options?: string[] } | null;
};

const COL_TYPES = [
  "text", "long_text", "number", "boolean", "secret",
  "url", "email", "date", "datetime", "select", "json",
];

type Props = {
  databaseId: string;
  columns: Column[];
  onClose: () => void;
  onChanged: () => void;
};

const inputCls =
  "w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-2 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-900 dark:text-neutral-100 placeholder:text-gray-400 dark:placeholder:text-neutral-500";

export default function SchemaEditModal({
  databaseId,
  columns,
  onClose,
  onChanged,
}: Props) {
  const [newCol, setNewCol] = useState({ name: "", key: "", type: "text", options: "" });
  const [error, setError] = useState<string | null>(null);
  const [optionInput, setOptionInput] = useState<Record<string, string>>({});
  const [optionError, setOptionError] = useState<Record<string, string>>({});

  async function addColumn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = {
      name: newCol.name,
      key: newCol.key,
      type: newCol.type,
    };
    if (newCol.type === "select") {
      body.config = {
        options: newCol.options.split(",").map((s) => s.trim()).filter(Boolean),
      };
    }
    const res = await fetch(`/api/databases/${databaseId}/columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j?.detail === "string" ? j.detail : "Add failed");
      return;
    }
    setNewCol({ name: "", key: "", type: "text", options: "" });
    onChanged();
  }

  async function renameColumn(c: Column, name: string) {
    const res = await fetch(`/api/databases/${databaseId}/columns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) onChanged();
  }

  async function changeType(c: Column, type: string) {
    const ok = await confirmDialog({
      title: `Change "${c.name}" to ${type}?`,
      message: `Current type: ${c.type}. Cells that can't be coerced become null.`,
      confirmLabel: "Change type",
      variant: "danger",
    });
    if (!ok) return;
    const res = await fetch(`/api/databases/${databaseId}/columns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (res.ok) {
      const j = await res.json();
      if (j?.coercion) {
        alert(`Coerced: ${j.coercion.coerced}, nulled: ${j.coercion.nulled}`);
      }
      onChanged();
    }
  }

  async function updateOptions(c: Column, newOptions: string[]) {
    setOptionError((m) => ({ ...m, [c.id]: "" }));
    const res = await fetch(`/api/databases/${databaseId}/columns/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { options: newOptions } }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const detail = j?.detail;
      if (detail?.error === "options_in_use") {
        const count = detail.affected_row_ids?.length ?? 0;
        setOptionError((m) => ({
          ...m,
          [c.id]: `${count} row${count === 1 ? "" : "s"} still use a removed option — clear those values first.`,
        }));
      } else {
        setOptionError((m) => ({
          ...m,
          [c.id]: typeof detail === "string" ? detail : "Update failed",
        }));
      }
      return;
    }
    onChanged();
  }

  async function addOption(c: Column) {
    const raw = (optionInput[c.id] ?? "").trim();
    if (!raw) return;
    const existing = c.config?.options ?? [];
    if (existing.includes(raw)) {
      setOptionError((m) => ({ ...m, [c.id]: "Option already exists." }));
      return;
    }
    setOptionInput((m) => ({ ...m, [c.id]: "" }));
    await updateOptions(c, [...existing, raw]);
  }

  async function removeOption(c: Column, option: string) {
    const existing = c.config?.options ?? [];
    await updateOptions(c, existing.filter((o) => o !== option));
  }

  async function deleteColumn(c: Column) {
    const ok = await confirmDialog({
      title: `Delete column "${c.name}"?`,
      message: "Values for this column are removed from every row.",
    });
    if (!ok) return;
    const res = await fetch(`/api/databases/${databaseId}/columns/${c.id}`, {
      method: "DELETE",
    });
    if (res.ok) onChanged();
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="fixed inset-0 bg-black/40 z-50"
        onClick={onClose}
      />
      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
          className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl shadow-xl pointer-events-auto w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-neutral-800">
            <h2 className="font-semibold text-sm">Edit schema</h2>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* Existing columns */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400 mb-2">
                Columns
              </h3>
              {columns.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-neutral-400">No columns yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-neutral-400 border-b border-gray-200 dark:border-neutral-800">
                      <th className="py-2 pr-2 font-medium">Name</th>
                      <th className="py-2 pr-2 font-medium">Key</th>
                      <th className="py-2 pr-2 font-medium">Type</th>
                      <th className="py-2 text-right font-medium w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((c) => (
                      <Fragment key={c.id}>
                        <tr className="border-b border-gray-100 dark:border-neutral-800/60">
                          <td className="py-2 pr-2">
                            <input
                              className={inputCls}
                              defaultValue={c.name}
                              onBlur={(e) => {
                                if (e.target.value !== c.name) renameColumn(c, e.target.value);
                              }}
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <code className="font-mono text-xs bg-gray-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-gray-600 dark:text-neutral-400">
                              {c.key}
                            </code>
                          </td>
                          <td className="py-2 pr-2">
                            <select
                              className={inputCls}
                              value={c.type}
                              onChange={(e) => changeType(c, e.target.value)}
                            >
                              {COL_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={() => deleteColumn(c)}
                              className="text-xs px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-100"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                        {c.type === "select" && (
                          <tr className="border-b border-gray-100 dark:border-neutral-800/60">
                            <td colSpan={4} className="pb-3 px-2">
                              <div className="flex items-center gap-2 flex-wrap pl-2">
                                <span className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-neutral-500">
                                  Options
                                </span>
                                {(c.config?.options ?? []).map((opt) => (
                                  <span
                                    key={opt}
                                    className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 pl-2 pr-1 py-0.5 rounded"
                                  >
                                    {opt}
                                    <button
                                      type="button"
                                      onClick={() => removeOption(c, opt)}
                                      className="text-blue-500/70 hover:text-red-500 px-0.5 leading-none"
                                      aria-label={`Remove ${opt}`}
                                    >
                                      &times;
                                    </button>
                                  </span>
                                ))}
                                <input
                                  className="text-xs border border-gray-200 dark:border-neutral-700 rounded px-2 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 w-32"
                                  placeholder="new option"
                                  value={optionInput[c.id] ?? ""}
                                  onChange={(e) =>
                                    setOptionInput((m) => ({ ...m, [c.id]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      addOption(c);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => addOption(c)}
                                  className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors duration-100"
                                >
                                  Add
                                </button>
                              </div>
                              {optionError[c.id] && (
                                <p className="text-xs text-red-600 dark:text-red-400 pl-2 mt-1">
                                  {optionError[c.id]}
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Add column form */}
            <form onSubmit={addColumn} className="pt-2 border-t border-gray-200 dark:border-neutral-800 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-neutral-400 pt-2">
                Add column
              </h3>
              <div className="flex flex-wrap gap-2 items-start">
                <input
                  className={`${inputCls} flex-1 min-w-32`}
                  placeholder="Name"
                  required
                  value={newCol.name}
                  onChange={(e) => setNewCol({ ...newCol, name: e.target.value })}
                />
                <input
                  className={`${inputCls} flex-1 min-w-32 font-mono`}
                  placeholder="Key (lower_snake)"
                  required
                  value={newCol.key}
                  onChange={(e) => setNewCol({ ...newCol, key: e.target.value })}
                />
                <select
                  className={`${inputCls} w-40`}
                  value={newCol.type}
                  onChange={(e) => setNewCol({ ...newCol, type: e.target.value })}
                >
                  {COL_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="text-sm px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100 whitespace-nowrap"
                >
                  Add
                </button>
              </div>
              {newCol.type === "select" && (
                <input
                  className={inputCls}
                  placeholder="Comma-separated options"
                  value={newCol.options}
                  onChange={(e) => setNewCol({ ...newCol, options: e.target.value })}
                />
              )}
              {error && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
                  {error}
                </div>
              )}
            </form>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-200 dark:border-neutral-800 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-4 py-1.5 border border-gray-200 dark:border-neutral-700 rounded text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors duration-100"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}
