"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";

/**
 * A destructive confirmation that needs something typed first (the server's name, your password,
 * your username). The confirm button stays disabled until `canConfirm(value)`; `onConfirm` returns
 * an error to show, or null when it went through (the caller then closes the dialog or moves on).
 */
export function TypeToConfirmDialog({
  title,
  message,
  label,
  inputType = "text",
  autoComplete = "off",
  confirmLabel,
  busyLabel = "Working…",
  canConfirm,
  onConfirm,
  onClose,
}: {
  title: ReactNode;
  message: ReactNode;
  label: string;
  inputType?: "text" | "password";
  autoComplete?: string;
  confirmLabel: string;
  busyLabel?: string;
  canConfirm: (value: string) => boolean;
  onConfirm: (value: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = canConfirm(value) && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    let err: string | null;
    try {
      err = await onConfirm(value);
    } catch (e) {
      console.error(e);
      err = "Something went wrong — try again.";
    } finally {
      setBusy(false);
    }
    if (err) setError(err);
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} title={title} size="sm">
      <form onSubmit={submit} className="px-5 py-4">
        <div className="text-body text-muted">{message}</div>
        <label className="mt-4 block">
          <span className="block text-meta font-medium text-muted mb-1">{label}</span>
          <input
            type={inputType}
            autoFocus
            autoComplete={autoComplete}
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            className="w-full rounded-control bg-surface-2 border border-line px-3 py-2 text-body text-ink outline-none focus:border-accent aria-[invalid=true]:border-danger disabled:opacity-60"
          />
        </label>
        {error && <p role="alert" className="mt-2 text-meta text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-control px-4 py-2 text-body font-medium text-ink hover:bg-surface-2 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={!ready}
            className="rounded-control px-4 py-2 text-body font-medium text-white bg-danger hover:bg-danger/90 disabled:opacity-50">
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
