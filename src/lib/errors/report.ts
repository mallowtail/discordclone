// The built-in error log (migration 0057): turning a browser error into a small, scrubbed report,
// and a reporter that drops repeats and stops after a handful per page. The database scrubs,
// truncates, dedupes and rate-limits again — that's the part that counts; this keeps private bits
// from ever leaving the browser and keeps an error loop from hammering the network.

/** Stored sizes (the database cuts to the same). */
export const ERROR_LIMITS = { message: 500, stack: 4000, path: 200, userAgent: 300 } as const;

export type ErrorKind = "error" | "rejection" | "boundary";

export type ErrorReport = {
  message: string;
  stack: string | null;
  path: string;
  userAgent: string | null;
  kind: ErrorKind;
};

/**
 * Blank out anything that looks like a token, email, URL query or hash parameter, a
 * "password=…"-style value, a long random string (keys) or a long quoted string (could be
 * someone's message text). Same rules and order as `scrub_error_text` (0058).
 */
export function scrubErrorText(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]*){0,2}/g, "[token]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g, "[email]")
    .replace(/\?[^\s"'<>)]+/g, "?[query]")
    .replace(/#[^\s"'<>)]*=[^\s"'<>)]*/g, "#[hash]")
    .replace(/(bearer|basic)\s+[^\s"',;]+/gi, "$1 [token]")
    .replace(
      /(access_token|refresh_token|token|secret|password|passwd|api[_-]?key|apikey|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&)]+/gi,
      "$1$2[redacted]",
    )
    .replace(/[A-Za-z0-9_+=-]{40,}/g, "[token]")
    .replace(/"[^"]{60,}"/g, '"[text]"')
    .replace(/'[^']{60,}'/g, "'[text]'");
}

/** Cut huge input first (cheap regexes), scrub, then cut to the stored size. */
function clean(text: string, max: number): string {
  return scrubErrorText(text.slice(0, max * 2)).slice(0, max).trim();
}

/** The page path only — never the query string or hash (`?next=…`, `#access_token=…`). */
export function cleanPath(path: string): string {
  return clean(path.split(/[?#]/, 1)[0] ?? "", ERROR_LIMITS.path);
}

/** Message and stack from whatever was thrown (Errors, strings, `{ message }` objects, anything). */
export function errorParts(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) {
    const name = value.name && value.name !== "Error" ? `${value.name}: ` : "";
    return { message: `${name}${value.message || "(no message)"}`, stack: value.stack ?? null };
  }
  if (typeof value === "string") return { message: value, stack: null };
  if (value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string") {
    const v = value as { message: string; stack?: unknown };
    return { message: v.message, stack: typeof v.stack === "string" ? v.stack : null };
  }
  if (value === undefined || value === null) return { message: `(${String(value)})`, stack: null };
  // Avoid JSON of arbitrary objects (could hold private data): say only what kind it was.
  return { message: `Non-error thrown: ${typeof value}`, stack: null };
}

/**
 * Errors not worth logging: cross-origin "Script error." (no detail at all), the harmless
 * ResizeObserver loop warning, and errors from browser extensions.
 */
export function isNoise(message: string, stack: string | null): boolean {
  if (/^(uncaught )?script error\.?$/i.test(message.trim())) return true;
  if (/ResizeObserver loop/i.test(message)) return true;
  if (/(chrome|moz|safari(-web)?)-extension:\/\//i.test(stack ?? "")) return true;
  return false;
}

/** The report to send for `value`, or null when there's nothing useful (or it's noise). */
export function buildErrorReport(input: {
  value: unknown;
  kind: ErrorKind;
  path: string;
  userAgent?: string | null;
  /** Next.js' id for a server-side error (its message is generic in production). */
  digest?: string | null;
}): ErrorReport | null {
  const parts = errorParts(input.value);
  if (isNoise(parts.message, parts.stack)) return null;
  const digest = input.digest && /^[\w-]{1,64}$/.test(input.digest) ? ` [digest ${input.digest}]` : "";
  const message = clean(parts.message, ERROR_LIMITS.message - digest.length) + digest;
  if (!message.trim()) return null;
  const stack = parts.stack ? clean(parts.stack, ERROR_LIMITS.stack) || null : null;
  const userAgent = input.userAgent ? clean(input.userAgent, ERROR_LIMITS.userAgent) || null : null;
  return { message, stack, path: cleanPath(input.path), userAgent, kind: input.kind };
}

/** Same message on the same page counts as the same error (as in the database). */
export function errorKey(report: Pick<ErrorReport, "message" | "path">): string {
  return `${report.path}\n${report.message}`;
}

export type ErrorReporter = { report: (r: ErrorReport) => boolean };

/**
 * Sends reports through `send`, skipping one already sent in the last `windowMs`, and stopping
 * after `maxPerPage` for this page load. `send` failing (offline, limit) is swallowed — a report
 * that fails is never retried or reported, so reporting can't loop. Returns whether it was sent.
 */
export function createErrorReporter(opts: {
  send: (r: ErrorReport) => Promise<unknown>;
  now?: () => number;
  windowMs?: number;
  maxPerPage?: number;
}): ErrorReporter {
  const now = opts.now ?? Date.now;
  const windowMs = opts.windowMs ?? 60_000;
  const maxPerPage = opts.maxPerPage ?? 20;
  const lastSent = new Map<string, number>();
  let sent = 0;
  return {
    report(r) {
      if (sent >= maxPerPage) return false;
      const key = errorKey(r);
      const t = now();
      const last = lastSent.get(key);
      if (last !== undefined && t - last < windowMs) return false;
      lastSent.set(key, t);
      sent++;
      try {
        opts.send(r).catch(() => {});
      } catch {
        // a synchronous throw from send: dropped, never re-reported
      }
      return true;
    },
  };
}
