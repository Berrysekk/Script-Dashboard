"use client";
import { motion } from "motion/react";

type Props = {
  title: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  right?: React.ReactNode;
  /** Small, muted, normal-case hint shown right next to the title. */
  hint?: string;
};

export default function SectionHeader({
  title,
  count,
  collapsed,
  onToggle,
  right,
  hint,
}: Props) {
  const isCollapsible = typeof collapsed === "boolean" && !!onToggle;
  const titleNode = (
    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 leading-none">
      {isCollapsible && (
        <motion.span
          animate={{ rotate: collapsed ? -90 : 0 }}
          transition={{ duration: 0.12 }}
          className="inline-flex"
          aria-hidden
        >
          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5">
            <path
              d="M2 4 L6 8 L10 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.span>
      )}
      <span>{title}</span>
      {typeof count === "number" && count > 0 && (
        <span className="font-normal text-gray-400 normal-case tracking-normal">· {count}</span>
      )}
      {hint && (
        <span className="font-normal text-gray-400 normal-case tracking-normal">{hint}</span>
      )}
    </p>
  );

  return (
    <div className="flex items-center justify-between gap-3 mb-3 min-h-[26px]">
      {isCollapsible ? (
        <button
          onClick={onToggle}
          className="flex-1 flex items-center text-left cursor-pointer h-[26px] leading-none"
        >
          {titleNode}
        </button>
      ) : (
        <div className="flex-1 flex items-center h-[26px] leading-none">{titleNode}</div>
      )}
      {right && <div className="shrink-0 flex items-center gap-2 h-[26px]">{right}</div>}
    </div>
  );
}
