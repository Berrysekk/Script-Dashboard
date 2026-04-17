"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export type SelectOption<V extends string = string> = {
  value: V;
  label: string;
  disabled?: boolean;
};

type Props<V extends string = string> = {
  value: V;
  options: SelectOption<V>[];
  onChange: (v: V) => void;
  disabled?: boolean;
  placeholder?: string;
  size?: "sm" | "md";
  className?: string;
  buttonClassName?: string;
  /** Accessible label for screen readers when no visible label is attached. */
  ariaLabel?: string;
};

export default function Select<V extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Select…",
  size = "md",
  className = "",
  buttonClassName = "",
  ariaLabel,
}: Props<V>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const current = options.find((o) => o.value === value);
  const padding = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => {
          const start = h < 0 ? 0 : h + 1;
          for (let i = start; i < options.length; i++)
            if (!options[i].disabled) return i;
          return h;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => {
          const start = h <= 0 ? options.length - 1 : h - 1;
          for (let i = start; i >= 0; i--)
            if (!options[i].disabled) return i;
          return h;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlight >= 0 && !options[highlight]?.disabled) {
          onChange(options[highlight].value);
          setOpen(false);
        }
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, highlight, options, onChange]);

  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setHighlight(idx);
    }
  }, [open, options, value]);

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`
          inline-flex items-center justify-between gap-2 w-full
          rounded border border-gray-300 dark:border-neutral-700
          bg-white dark:bg-neutral-900
          text-gray-800 dark:text-neutral-200
          ${padding}
          transition-colors duration-100
          ${
            disabled
              ? "opacity-50 cursor-not-allowed"
              : "cursor-pointer hover:border-gray-400 dark:hover:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
          }
          ${buttonClassName}
        `}
      >
        <span className={`truncate ${!current ? "text-gray-400 dark:text-neutral-500" : ""}`}>
          {current ? current.label : placeholder}
        </span>
        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.1 }}
          viewBox="0 0 12 12"
          className="w-2.5 h-2.5 text-gray-400 dark:text-neutral-500 shrink-0"
          aria-hidden
        >
          <path
            d="M2 4 L6 8 L10 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && !disabled && (
          <motion.ul
            ref={listRef}
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.1 }}
            className="absolute z-40 mt-1 min-w-full max-h-60 overflow-y-auto rounded border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg py-1"
          >
            {options.map((o, i) => {
              const selected = o.value === value;
              const highlighted = i === highlight;
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => {
                    if (o.disabled) return;
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`
                    flex items-center gap-2 px-2.5 py-1.5 text-xs whitespace-nowrap
                    ${o.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
                    ${
                      highlighted && !o.disabled
                        ? "bg-gray-100 dark:bg-neutral-800"
                        : ""
                    }
                    ${selected ? "text-blue-600 dark:text-blue-400 font-medium" : "text-gray-700 dark:text-neutral-300"}
                  `}
                >
                  <span className="flex-1 truncate">{o.label}</span>
                  {selected && (
                    <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0" aria-hidden>
                      <path
                        d="M3 8.5 L6.5 12 L13 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
