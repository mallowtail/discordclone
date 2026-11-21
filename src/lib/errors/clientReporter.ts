// The browser side of the error log: one reporter per page, fed by the window `error` /
// `unhandledrejection` listeners (installed once from src/instrumentation-client.ts) and by the
// React error boundaries (src/app/error.tsx, (app)/error.tsx, global-error.tsx).

import { buildErrorReport, createErrorReporter, type ErrorKind, type ErrorReport, type ErrorReporter } from "@/lib/errors/report";

let reporter: ErrorReporter | null = null;
let installed = false;
// Loaded on first use (one shared import) so the page's start-up stays light.
let clientModule: Promise<typeof import("@/lib/supabase/client")> | null = null;

/** Ship one report with the signed-in person's session (or anonymously) via `log_client_error`. */
async function send(r: ErrorReport): Promise<void> {
  clientModule ??= import("@/lib/supabase/client");
  const { createClient } = await clientModule;
  await createClient().rpc("log_client_error", {
    p_message: r.message,
    p_stack: r.stack,
    p_path: r.path,
    p_user_agent: r.userAgent,
    p_kind: r.kind,
  });
}

function getReporter(): ErrorReporter {
  reporter ??= createErrorReporter({ send });
  return reporter;
}

/** Report something thrown. Never throws itself (an error while reporting is dropped, not reported). */
export function reportClientError(value: unknown, kind: ErrorKind, digest?: string | null): void {
  try {
    if (typeof window === "undefined") return;
    const r = buildErrorReport({
      value, kind, digest,
      path: window.location.pathname,
      userAgent: window.navigator.userAgent,
    });
    if (r) getReporter().report(r);
  } catch {
    // never let the reporter itself cause another error event
  }
}

/** Listen for uncaught errors and unhandled promise rejections (once per page). */
export function installErrorCapture(target: Window): void {
  if (installed) return;
  installed = true;
  target.addEventListener("error", (e: ErrorEvent) => reportClientError(e.error ?? e.message, "error"));
  target.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => reportClientError(e.reason, "rejection"));
}

/** Tests only: forget the reporter and the install flag. */
export function resetClientReporterForTests(): void {
  reporter = null;
  installed = false;
  clientModule = null;
}
