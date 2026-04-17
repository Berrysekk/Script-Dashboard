"use client";
import { motion } from "motion/react";

type Props = {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
};

export default function Checkbox({
  checked,
  onChange,
  disabled = false,
  size = "md",
  className = "",
  ariaLabel,
}: Props) {
  const dim = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const interactive = !!onChange && !disabled;

  const boxClass = `
    inline-flex items-center justify-center shrink-0 rounded ${dim}
    border transition-colors duration-100
    ${
      checked
        ? "bg-blue-600 border-blue-600"
        : "bg-white dark:bg-neutral-900 border-gray-300 dark:border-neutral-600"
    }
    ${
      interactive
        ? "cursor-pointer hover:border-blue-500 dark:hover:border-blue-500"
        : ""
    }
    ${disabled ? "opacity-50 cursor-not-allowed" : ""}
    ${className}
  `;

  const content = (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      tabIndex={interactive ? 0 : -1}
      onClick={(e) => {
        if (!interactive) return;
        e.preventDefault();
        e.stopPropagation();
        onChange!(!checked);
      }}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange!(!checked);
        }
      }}
      className={boxClass}
    >
      {checked && (
        <motion.svg
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.1 }}
          viewBox="0 0 16 16"
          className={`${size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"} text-white`}
          aria-hidden
        >
          <path
            d="M3 8.5 L6.5 12 L13 4.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </motion.svg>
      )}
    </span>
  );

  return content;
}
