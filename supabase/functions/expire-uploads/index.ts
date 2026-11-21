// expire-uploads: the daily clean-up (free-plan limits, migration 0054).
//
// Who can run it:
//   - the pg_cron job: sends the x-cleanup-secret header (a random secret kept in Vault, checked
//     with cleanup_secret_ok, which only the service role can call);
//   - the site admin ("Run clean-up now" on /admin): calls it with their own login
//     (supabase.functions.invoke sends it); it runs only if is_site_admin() is true for that login.
//   Anyone else gets 401 / 403. Deployed with JWT verification off, since the cron call has no JWT.
//
// What it does (each step is an RPC in the database, service role only):
//   cleanup_start → expire_uploads('age') → expire_uploads('pressure') → expire_messages,
//   removing the files each step hands back (attachments bucket only, batches of up to 1000,
//   then cleanup_files_done) → cleanup_finish (with the error, if any).
//
// Response: 200 {ok: true, run, files_deleted, ...} or {ok: false, error}.

import { createClient } from "npm:@supabase/supabase-js@2.106.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

type Pending = { bucket: string; path: string; bytes: number };

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Who is calling: "cron", { admin: userId }, or null.
async function caller(req: Request): Promise<"cron" | { admin: string } | null> {
  const secret = req.headers.get("x-cleanup-secret");
  if (secret) {
    const { data, error } = await admin.rpc("cleanup_secret_ok", { given: secret });
    return !error && data === true ? "cron" : null;
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return null;
  const asUser = createClient(SUPABASE_URL, ANON_KEY || SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: isAdmin, error } = await asUser.rpc("is_site_admin");
  return !error && isAdmin === true ? { admin: userData.user.id } : null;
}

// Removes the files a step handed back; returns how many Storage reported removed.
async function removeFiles(run: string, files: Pending[]): Promise<number> {
  // Only ever the attachments bucket (the database never queues anything else).
  const paths = files.filter((f) => f.bucket === "attachments").map((f) => f.path);
  let removed = 0;
  for (let i = 0; i < paths.length; i += 1000) {
    const batch = paths.slice(i, i + 1000);
    const { data, error } = await admin.storage.from("attachments").remove(batch);
    if (error) throw new Error(`storage remove failed: ${error.message}`);
    const gone = (data ?? []).map((o) => o.name);
    // Storage returns only the objects it removed; the rest stay queued for the next run.
    if (gone.length > 0) {
      const { error: doneError } = await admin.rpc("cleanup_files_done", { run, paths: gone });
      if (doneError) throw new Error(`cleanup_files_done failed: ${doneError.message}`);
    }
    removed += gone.length;
  }
  return removed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply(405, { ok: false, error: "use POST" });

  const who = await caller(req);
  if (!who) return reply(401, { ok: false, error: "not permitted" });

  const { data: run, error: startError } = await admin.rpc("cleanup_start", {
    trigger: who === "cron" ? "cron" : "admin",
    actor: who === "cron" ? null : who.admin,
  });
  if (startError || !run) {
    return reply(409, { ok: false, error: startError?.message ?? "could not start" });
  }

  let filesDeleted = 0;
  let failure: string | null = null;
  try {
    const steps: [string, Record<string, unknown>][] = [
      ["expire_uploads", { mode: "age", run }],
      ["expire_uploads", { mode: "pressure", run }],
      ["expire_messages", { run }],
    ];
    for (const [fn, args] of steps) {
      const { data, error } = await admin.rpc(fn, args);
      if (error) throw new Error(`${fn} failed: ${error.message}`);
      filesDeleted += await removeFiles(run as string, (data ?? []) as Pending[]);
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }

  const { error: finishError } = await admin.rpc("cleanup_finish", { run, error: failure });
  if (finishError && !failure) failure = `cleanup_finish failed: ${finishError.message}`;

  return reply(failure ? 500 : 200, {
    ok: !failure,
    run,
    trigger: who === "cron" ? "cron" : "admin",
    files_deleted: filesDeleted,
    error: failure,
  });
});
