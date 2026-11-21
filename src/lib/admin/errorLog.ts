// /admin → Errors (migration 0057): rows from `client_errors` grouped by message for display,
// plus a short browser name from a user agent. Display only — the database decides who may read.

export type ClientErrorRow = {
  id: number;
  message: string;
  stack: string | null;
  path: string;
  user_agent: string | null;
  kind: "error" | "rejection" | "boundary";
  count: number;
  first_seen: string;
  last_seen: string;
  user: { username: string } | null;
};

export type ErrorGroup = {
  message: string;
  /** Times seen across all its rows. */
  total: number;
  firstSeen: string;
  lastSeen: string;
  /** Pages it happened on, most hits first. */
  paths: { path: string; count: number }[];
  /** Different browsers it happened in, most recent first. */
  browsers: string[];
  /** Usernames of signed-in people who hit it (the database keeps the latest per row). */
  users: string[];
  /** True when at least one hit came from someone not signed in (or a row without a user). */
  anonymous: boolean;
  /** The most recent row (its stack and kind are shown). */
  latest: ClientErrorRow;
};

/** How many rows /admin loads (the table keeps at most 5,000). */
export const ERROR_ROWS_LOADED = 1000;

/** The select for the Errors tab (the user's name comes through the profiles foreign key). */
export const ERROR_ROWS_SELECT = "id,message,stack,path,user_agent,kind,count,first_seen,last_seen,user:profiles(username)";

/** Group rows by message, newest group first. Rows come in any order. */
export function groupErrors(rows: readonly ClientErrorRow[]): ErrorGroup[] {
  const groups = new Map<string, { g: ErrorGroup; pathCounts: Map<string, number> }>();
  const sorted = [...rows].sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen));
  for (const r of sorted) {
    let entry = groups.get(r.message);
    if (!entry) {
      entry = {
        g: { message: r.message, total: 0, firstSeen: r.first_seen, lastSeen: r.last_seen, paths: [], browsers: [], users: [], anonymous: false, latest: r },
        pathCounts: new Map(),
      };
      groups.set(r.message, entry);
    }
    const { g, pathCounts } = entry;
    g.total += r.count;
    if (Date.parse(r.first_seen) < Date.parse(g.firstSeen)) g.firstSeen = r.first_seen;
    pathCounts.set(r.path, (pathCounts.get(r.path) ?? 0) + r.count);
    const browser = browserName(r.user_agent);
    if (!g.browsers.includes(browser)) g.browsers.push(browser);
    if (r.user?.username) {
      if (!g.users.includes(r.user.username)) g.users.push(r.user.username);
    } else {
      g.anonymous = true;
    }
  }
  return [...groups.values()].map(({ g, pathCounts }) => ({
    ...g,
    paths: [...pathCounts].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count),
  }));
}

/** "Chrome 131 on Windows", "Safari on iPhone", … from a user agent; "Unknown browser" if none. */
export function browserName(ua: string | null | undefined): string {
  if (!ua) return "Unknown browser";
  const version = (re: RegExp) => ua.match(re)?.[1]?.split(".")[0];
  let browser: string;
  let v: string | undefined;
  if ((v = version(/Edg(?:e|A|iOS)?\/([\d.]+)/))) browser = "Edge";
  else if ((v = version(/(?:OPR|Opera)\/([\d.]+)/))) browser = "Opera";
  else if ((v = version(/SamsungBrowser\/([\d.]+)/))) browser = "Samsung Internet";
  else if ((v = version(/(?:Firefox|FxiOS)\/([\d.]+)/))) browser = "Firefox";
  else if ((v = version(/(?:Chrome|CriOS)\/([\d.]+)/))) browser = "Chrome";
  else if (/Safari\//.test(ua)) { browser = "Safari"; v = version(/Version\/([\d.]+)/); }
  else browser = "Unknown browser";

  let os: string | null = null;
  if (/iPhone/.test(ua)) os = "iPhone";
  else if (/iPad/.test(ua)) os = "iPad";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "Mac";
  else if (/Linux/.test(ua)) os = "Linux";

  const name = v && browser !== "Unknown browser" ? `${browser} ${v}` : browser;
  return os ? `${name} on ${os}` : name;
}

/** Words for where the error was caught. */
export function errorKindLabel(kind: ClientErrorRow["kind"]): string {
  if (kind === "boundary") return "Page crashed";
  if (kind === "rejection") return "Unhandled promise";
  return "Uncaught error";
}

/** "1 time" / "12 times". */
export function timesText(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "time" : "times"}`;
}

/** What "Clear" says when it worked. */
export function clearedText(n: number): string {
  return n === 0 ? "Nothing to clear." : `Cleared ${n.toLocaleString("en-US")} ${n === 1 ? "entry" : "entries"}.`;
}

/** What "Clear" says when the database refused or the request failed. */
export function clearErrorsFailedText(message: string | undefined): string {
  if (message?.includes("not permitted")) return "Only the Mallowchat admin can do that.";
  return "Couldn't clear the errors — try again.";
}
