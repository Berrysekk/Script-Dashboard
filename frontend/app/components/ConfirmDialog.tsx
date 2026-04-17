"use client";
import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";

type Variant = "danger" | "default";

type Options = {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
};

type Resolver = (ok: boolean) => void;

type PendingRequest = Options & { resolve: Resolver };

let requester: ((opts: Options) => Promise<boolean>) | null = null;

/** Imperative API — call from any event handler. Resolves to true/false. */
export function confirmDialog(opts: Options): Promise<boolean> {
  if (!requester) {
    // Fallback: host not mounted (shouldn't happen once AppShell renders).
    return Promise.resolve(window.confirm(opts.title));
  }
  return requester(opts);
}

/** Mount once near the top of the tree (e.g. in AppShell). */
export default function ConfirmDialogHost() {
  const [req, setReq] = useState<PendingRequest | null>(null);

  useEffect(() => {
    requester = (opts) =>
      new Promise<boolean>((resolve) => {
        setReq({ ...opts, resolve });
      });
    return () => {
      requester = null;
    };
  }, []);

  const close = useCallback(
    (ok: boolean) => {
      if (!req) return;
      req.resolve(ok);
      setReq(null);
    },
    [req]
  );

  useEffect(() => {
    if (!req) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, close]);

  const variant: Variant = req?.variant ?? "danger";
  const confirmClass =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : "bg-blue-600 hover:bg-blue-700 text-white";

  return (
    <AnimatePresence>
      {req && (
        <>
          <motion.div
            key="confirm-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 bg-black/40 z-[60]"
            onClick={() => close(false)}
          />
          <div className="fixed inset-0 flex items-center justify-center z-[60] pointer-events-none px-4">
            <motion.div
              key="confirm-dialog"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-title"
              className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl p-5 w-full max-w-sm shadow-xl pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="confirm-title"
                className="text-sm font-semibold text-gray-900 dark:text-neutral-100"
              >
                {req.title}
              </h2>
              {req.message && (
                <div className="mt-2 text-sm text-gray-600 dark:text-neutral-400">
                  {req.message}
                </div>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  type="button"
                  onClick={() => close(false)}
                  className="text-sm px-4 py-1.5 border border-gray-200 dark:border-neutral-700 rounded text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors duration-100"
                >
                  {req.cancelLabel ?? "Cancel"}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  type="button"
                  autoFocus
                  onClick={() => close(true)}
                  className={`text-sm px-4 py-1.5 rounded transition-colors duration-100 ${confirmClass}`}
                >
                  {req.confirmLabel ?? "Delete"}
                </motion.button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
