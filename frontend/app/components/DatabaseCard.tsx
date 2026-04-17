"use client";
import Link from "next/link";
import { motion } from "motion/react";

export type Database = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  row_count: number;
  column_count: number;
};

type Props = {
  db: Database;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

export default function DatabaseCard({ db, isAdmin, onEdit, onDelete }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl overflow-hidden flex flex-col"
    >
      <Link href={`/databases/${db.id}`} className="block px-4 pt-4 pb-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-base leading-snug">{db.name}</span>
          <code className="bg-gray-100 dark:bg-neutral-800 px-2 py-0.5 rounded text-xs font-mono text-gray-600 dark:text-neutral-400 shrink-0">
            {db.slug}
          </code>
        </div>
        {db.description && (
          <p className="text-sm text-gray-600 dark:text-neutral-400 mt-2">{db.description}</p>
        )}
        <div className="flex gap-4 mt-3">
          <span className="text-xs text-gray-500 dark:text-neutral-500">{db.row_count} rows</span>
          <span className="text-xs text-gray-500 dark:text-neutral-500">{db.column_count} cols</span>
        </div>
      </Link>
      {isAdmin && (
        <div className="border-t border-gray-200 dark:border-neutral-800 px-4 py-2 flex gap-2">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
            className="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors duration-100"
          >
            Edit
          </button>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            className="text-xs px-2.5 py-1 rounded border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-100"
          >
            Delete
          </button>
        </div>
      )}
    </motion.div>
  );
}
