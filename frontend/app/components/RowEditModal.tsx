"use client";

import { useState } from "react";
import { motion } from "motion/react";

type Column = {
  id: string;
  name: string;
  key: string;
  type: string;
  config: { options?: string[] } | null;
};

type Props = {
  columns: Column[];
  initial?: Record<string, unknown>;
  isReadOnly?: boolean;
  onCancel: () => void;
  onSave: (values: Record<string, unknown>) => Promise<void>;
};

const inputCls =
  "w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-2 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-900 dark:text-neutral-100 placeholder:text-gray-400 dark:placeholder:text-neutral-500 disabled:opacity-60";

const typeMap: Record<string, string> = {
  text: "text",
  number: "number",
  url: "url",
  email: "email",
  date: "date",
  datetime: "datetime-local",
};

export default function RowEditModal({
  columns,
  initial,
  isReadOnly,
  onCancel,
  onSave,
}: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(initial ?? {});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function set(key: string, v: unknown) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const prepared: Record<string, unknown> = { ...values };
      for (const c of columns) {
        if (
          c.type === "json" &&
          typeof prepared[c.key] === "string" &&
          prepared[c.key]
        ) {
          try {
            prepared[c.key] = JSON.parse(prepared[c.key] as string);
          } catch {
            setErrors({ [c.key]: "invalid JSON" });
            setSaving(false);
            return;
          }
        }
      }
      await onSave(prepared);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.errors) {
          setErrors(parsed.errors);
          return;
        }
      } catch {}
      setErrors({ _form: msg });
    } finally {
      setSaving(false);
    }
  }

  function renderInput(c: Column) {
    const v = values[c.key];
    const disabled = isReadOnly;

    // Boolean
    if (c.type === "boolean") {
      return (
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={Boolean(v)}
            disabled={disabled}
            onChange={(e) => set(c.key, e.target.checked)}
            className="rounded border-gray-300 dark:border-neutral-700"
          />
          <span>{v ? "true" : "false"}</span>
        </label>
      );
    }

    // Long text
    if (c.type === "long_text") {
      return (
        <textarea
          className={inputCls}
          rows={4}
          value={typeof v === "string" ? v : v != null ? String(v) : ""}
          disabled={disabled}
          onChange={(e) => set(c.key, e.target.value)}
        />
      );
    }

    // JSON
    if (c.type === "json") {
      const jsonVal =
        typeof v === "string"
          ? v
          : v != null
          ? JSON.stringify(v, null, 2)
          : "";
      return (
        <textarea
          className={`${inputCls} font-mono`}
          rows={5}
          value={jsonVal}
          disabled={disabled}
          onChange={(e) => set(c.key, e.target.value)}
        />
      );
    }

    // Select
    if (c.type === "select") {
      const options = c.config?.options ?? [];
      return (
        <select
          className={inputCls}
          value={typeof v === "string" ? v : ""}
          disabled={disabled}
          onChange={(e) => set(c.key, e.target.value)}
        >
          <option value="">— select —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }

    // Secret
    if (c.type === "secret") {
      return (
        <div className="flex gap-2">
          <input
            type={revealed[c.key] ? "text" : "password"}
            className={`${inputCls} flex-1 font-mono`}
            value={typeof v === "string" ? v : ""}
            disabled={disabled}
            onChange={(e) => set(c.key, e.target.value)}
          />
          {!disabled && (
            <button
              type="button"
              onClick={() =>
                setRevealed((prev) => ({ ...prev, [c.key]: !prev[c.key] }))
              }
              className="text-xs px-3 py-2 border border-gray-200 dark:border-neutral-700 rounded text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors duration-100"
            >
              {revealed[c.key] ? "Hide" : "Show"}
            </button>
          )}
        </div>
      );
    }

    // Mapped input types (text, number, url, email, date, datetime)
    const htmlType = typeMap[c.type] ?? "text";
    return (
      <input
        type={htmlType}
        className={inputCls}
        value={typeof v === "string" ? v : v != null ? String(v) : ""}
        disabled={disabled}
        onChange={(e) =>
          set(c.key, c.type === "number" ? e.target.valueAsNumber : e.target.value)
        }
      />
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="fixed inset-0 bg-black/40 z-50"
        onClick={onCancel}
      />
      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
          className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl shadow-xl pointer-events-auto w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-neutral-800">
            <h2 className="font-semibold text-sm">
              {isReadOnly ? "Row details" : initial ? "Edit row" : "Add row"}
            </h2>
          </div>

          {/* Scrollable form body + footer */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {columns.map((c) => (
                <div key={c.id} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-neutral-400">
                    {c.name}
                    <code className="ml-2 font-mono text-[11px] bg-gray-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-gray-500 dark:text-neutral-400">
                      {c.key}
                    </code>
                    <span className="ml-2 text-[11px] text-gray-400 dark:text-neutral-500">
                      {c.type}
                    </span>
                  </label>
                  {renderInput(c)}
                  {errors[c.key] && (
                    <div className="text-xs text-red-600 dark:text-red-400">
                      {errors[c.key]}
                    </div>
                  )}
                </div>
              ))}
              {errors._form && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
                  {errors._form}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-gray-200 dark:border-neutral-800 flex gap-2 justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="text-sm px-4 py-1.5 border border-gray-200 dark:border-neutral-700 rounded text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors duration-100"
              >
                Close
              </button>
              {!isReadOnly && (
                <button
                  type="submit"
                  disabled={saving}
                  className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors duration-100 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
}
