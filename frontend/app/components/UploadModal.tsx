"use client";
import { useState, useRef } from "react";
import { motion } from "motion/react";

type Props = { onClose: () => void; onUploaded: () => void; };

export default function UploadModal({ onClose, onUploaded }: Props) {
  const [name, setName]             = useState("");
  const [description, setDesc]      = useState("");
  const [file, setFile]             = useState<File | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [error, setError]           = useState("");
  const inputRef                    = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => { setFile(f); if (!name) setName(f.name.replace(/\.(py|zip)$/, "")); };

  const submit = async () => {
    if (!file) return;
    setUploading(true); setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("name", name);
    if (description) form.append("description", description);
    try {
      const res = await fetch("/api/scripts", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      onUploaded(); onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setUploading(false); }
  };

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        className="fixed inset-0 bg-black/40 z-50"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
          className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl p-6 w-full max-w-md shadow-xl pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm">Add Script</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">✕</button>
          </div>
          <motion.div
            whileHover={{ borderColor: "rgb(96, 165, 250)" }}
            className="border-2 border-dashed border-gray-300 dark:border-neutral-700 rounded-lg p-6 text-center cursor-pointer mb-4 transition-colors"
            onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" accept=".py,.zip" className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            {file
              ? <motion.p initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="text-sm font-medium text-blue-500">{file.name}</motion.p>
              : <p className="text-xs text-gray-400">Drop a <code>.py</code> or <code>.zip</code>, or click to browse</p>}
          </motion.div>
          <input className="w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-2 mb-2 bg-transparent focus:ring-1 focus:ring-blue-400 focus:outline-none transition-shadow"
            placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="w-full text-sm border border-gray-300 dark:border-neutral-700 rounded px-3 py-2 mb-4 bg-transparent focus:ring-1 focus:ring-blue-400 focus:outline-none transition-shadow"
            placeholder="Description (optional)" value={description} onChange={(e) => setDesc(e.target.value)} />
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-red-500 mb-2"
            >
              {error}
            </motion.p>
          )}
          <div className="flex gap-2 justify-end">
            <motion.button whileTap={{ scale: 0.97 }} onClick={onClose} className="text-sm px-4 py-1.5 border border-gray-200 dark:border-neutral-700 rounded">Cancel</motion.button>
            <motion.button whileTap={{ scale: 0.97 }} onClick={submit} disabled={!file || uploading}
              className="text-sm px-4 py-1.5 bg-blue-500 text-white rounded disabled:opacity-50">
              {uploading ? "Uploading..." : "Add Script"}
            </motion.button>
          </div>
        </motion.div>
      </div>
    </>
  );
}
