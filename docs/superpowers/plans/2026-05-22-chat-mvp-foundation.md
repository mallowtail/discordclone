# Chat MVP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a working chat app where a small group can register, log in, chat live in shared text channels, and exchange 1-on-1 direct messages.

**Architecture:** A Next.js (App Router) frontend talks directly to Supabase for auth, Postgres storage, and real-time message delivery. There is no custom backend server — Supabase Row Level Security (RLS) enforces access control, and Supabase Realtime broadcasts new message rows over websockets. Pure logic (validation, formatting) lives in small tested modules; UI is built from focused components.

**Tech Stack:** Next.js 15 + TypeScript + Tailwind CSS, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Vitest for unit tests, deployed on Vercel.

---

## Prerequisites (one-time, before Task 1)

These are manual setup steps the engineer does in a browser; they can't be scripted.

- [ ] **P1: Confirm Node is available.** In the project terminal run `node --version`. Expected: `v24.x` or any v20+. If "command not found", run `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` first (nvm was installed during brainstorming).
- [ ] **P2: Create a Supabase project.** Go to https://supabase.com → sign in → "New project". Name it (e.g. `school-chat`), pick a strong database password (save it), choose the closest region, Free plan. Wait ~2 min for provisioning.
- [ ] **P3: Copy the API keys.** In the Supabase dashboard → Project Settings → API. Copy the **Project URL** and the **anon public** key. You'll paste them into `.env.local` in Task 2.
- [ ] **P4: Create a Vercel account** (for deployment in Task 15) at https://vercel.com using "Continue with GitHub". No project yet.

## File Structure

```
website/
  package.json                         # scripts + deps
  next.config.ts
  tsconfig.json
  vitest.config.ts                     # test runner config
  .env.local                           # Supabase URL + anon key (gitignored)
  .env.example                         # template, committed
  supabase/
    migrations/
      0001_init.sql                    # tables, constraints, RLS, seed data
  src/
    lib/
      supabase/
        client.ts                      # browser Supabase client
        server.ts                      # server Supabase client (middleware/route use)
      validation.ts                    # pure: message + username validation
      format.ts                        # pure: timestamp + display helpers
    middleware.ts                      # refreshes the auth session cookie
    types/
      db.ts                            # hand-written row types
    components/
      providers/AuthProvider.tsx       # exposes current user + auth actions
      Sidebar.tsx                      # left pane: channels + DMs + user panel
      MessageList.tsx                  # scrollable messages for a channel/DM
      MessageItem.tsx                  # one message row
      MessageInput.tsx                 # the composer
      NewDmDialog.tsx                  # start a DM with another user
    hooks/
      useMessages.ts                   # load history + subscribe to realtime inserts
    app/
      layout.tsx                       # root layout, wraps AuthProvider
      globals.css                      # Tailwind + base styles
      page.tsx                         # redirect: -> /channels/general or /login
      login/page.tsx
      register/page.tsx
      (app)/layout.tsx                 # auth guard + 2-pane shell with Sidebar
      (app)/channels/[channelId]/page.tsx
      (app)/dms/[conversationId]/page.tsx
  tests/
    validation.test.ts
    format.test.ts
```

Each file has one responsibility. Pure logic (`validation.ts`, `format.ts`) is isolated so it can be unit-tested without a browser or database. The realtime/data concern lives entirely in `useMessages.ts` so components stay about rendering.

---

## Task 1: Scaffold the Next.js project

**Files:**
- Create: whole Next.js skeleton (`package.json`, `next.config.ts`, `tsconfig.json`, `src/app/*`, configs)

- [ ] **Step 1: Run create-next-app into the current directory**

The repo already exists (it has `.git` and `docs/`). Scaffold into it with the `.` target.

Run:
```bash
cd /home/mallow/projects/website
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```
If it asks about Turbopack, either answer is fine (defaults are OK). When prompted that the directory is not empty / to overwrite, **keep** existing files (`docs/`, `.git`, `.gitignore`, `.superpowers/`). Answer "Yes" to proceed; create-next-app does not delete unrelated folders.

- [ ] **Step 2: Verify it runs**

Run:
```bash
npm run dev
```
Expected: server starts on `http://localhost:3000`. Open it — you should see the default Next.js page. Stop with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with TypeScript and Tailwind"
```

---

## Task 2: Install dependencies and configure environment

**Files:**
- Modify: `package.json` (deps added by install)
- Create: `.env.local`, `.env.example`

- [ ] **Step 1: Install Supabase and Vitest packages**

Run:
```bash
npm install @supabase/supabase-js @supabase/ssr
npm install -D vitest
```

- [ ] **Step 2: Create `.env.example` (committed template)**

```
# Copy to .env.local and fill with values from Supabase dashboard → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

- [ ] **Step 3: Create `.env.local` with the real values from P3**

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

- [ ] **Step 4: Confirm `.env.local` is gitignored**

Run:
```bash
git check-ignore .env.local
```
Expected: prints `.env.local` (create-next-app's `.gitignore` ignores `.env*`). If it prints nothing, append `.env.local` to `.gitignore`.

- [ ] **Step 5: Commit (template only, not secrets)**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add Supabase + Vitest deps and env template"
```

---

## Task 3: Database schema, constraints, RLS, and seed

**Files:**
- Create: `supabase/migrations/0001_init.sql`

This SQL is run once in the Supabase SQL editor. It is the heart of the data model.

- [ ] **Step 1: Write the migration file `supabase/migrations/0001_init.sql`**

```sql
-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ============ CHANNELS ============
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ============ CONVERSATIONS (DMs) ============
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

-- ============ MESSAGES ============
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  -- a message lives in exactly one place: a channel OR a conversation
  constraint one_target check (
    (channel_id is not null and conversation_id is null) or
    (channel_id is null and conversation_id is not null)
  )
);
create index on public.messages (channel_id, created_at);
create index on public.messages (conversation_id, created_at);

-- ============ HELPER: is the current user a member of a conversation? ============
create or replace function public.is_conversation_member(conv uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv and user_id = auth.uid()
  );
$$;

-- ============ ENABLE RLS ============
alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- profiles: anyone logged in can read; you edit only your own
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);
create policy "insert own profile"
  on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "update own profile"
  on public.profiles for update to authenticated using (id = auth.uid());

-- channels: anyone logged in can read; no client writes (seeded only)
create policy "channels readable by authenticated"
  on public.channels for select to authenticated using (true);

-- conversations: only members can see
create policy "members read conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));
create policy "authenticated create conversations"
  on public.conversations for insert to authenticated with check (true);

-- conversation_members: members can read membership; you can add rows for yourself
create policy "read membership of own conversations"
  on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id));
create policy "add members to conversations"
  on public.conversation_members for insert to authenticated with check (true);

-- messages: read channel msgs if logged in; read DM msgs only if member
create policy "read channel messages"
  on public.messages for select to authenticated
  using (channel_id is not null);
create policy "read dm messages"
  on public.messages for select to authenticated
  using (conversation_id is not null and public.is_conversation_member(conversation_id));
-- insert: must be the author, and (channel always allowed) or (member of the DM)
create policy "send messages"
  on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and (
      channel_id is not null
      or (conversation_id is not null and public.is_conversation_member(conversation_id))
    )
  );

-- ============ REALTIME ============
alter publication supabase_realtime add table public.messages;

-- ============ SEED: one shared server's channels ============
insert into public.channels (name, position) values
  ('general', 0), ('homework', 1), ('memes', 2);
```

- [ ] **Step 2: Run the migration in Supabase**

In the Supabase dashboard → SQL Editor → New query → paste the entire file → Run. Expected: "Success. No rows returned" and the seed insert reports 3 rows. Verify under Table Editor that `channels` has 3 rows and all five tables exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: add database schema, RLS policies, and channel seed"
```

---

## Task 4: Supabase client modules

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/types/db.ts`

- [ ] **Step 1: Write `src/types/db.ts`**

```ts
export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Channel = {
  id: string;
  name: string;
  position: number;
  created_at: string;
};

export type Message = {
  id: string;
  author_id: string;
  channel_id: string | null;
  conversation_id: string | null;
  content: string;
  created_at: string;
};
```

- [ ] **Step 2: Write `src/lib/supabase/client.ts` (browser client)**

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: Write `src/lib/supabase/server.ts` (server client for middleware/route handlers)**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) =>
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          ),
      },
    }
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase src/types/db.ts
git commit -m "feat: add Supabase client modules and row types"
```

---

## Task 5: Session-refresh middleware

**Files:**
- Create: `src/middleware.ts`

This keeps the auth cookie fresh so server and client agree on who's logged in. It's the standard Supabase Next.js pattern.

- [ ] **Step 1: Write `src/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser(); // refreshes the session
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Verify the app still boots**

Run: `npm run dev`
Expected: starts cleanly on `:3000`, no middleware errors in the terminal. Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add Supabase session-refresh middleware"
```

---

## Task 6: Pure validation logic (TDD)

**Files:**
- Create: `src/lib/validation.ts`
- Test: `tests/validation.test.ts`
- Create: `vitest.config.ts`; Modify: `package.json` (test script)

- [ ] **Step 1: Add the test script and Vitest config**

In `package.json`, add to `"scripts"`: `"test": "vitest run"`.

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 2: Write the failing test `tests/validation.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { validateMessage, validateUsername } from "@/lib/validation";

describe("validateMessage", () => {
  it("accepts normal text", () => {
    expect(validateMessage("hello")).toEqual({ ok: true, value: "hello" });
  });
  it("trims surrounding whitespace", () => {
    expect(validateMessage("  hi  ")).toEqual({ ok: true, value: "hi" });
  });
  it("rejects empty / whitespace-only", () => {
    expect(validateMessage("   ").ok).toBe(false);
  });
  it("rejects over 2000 chars", () => {
    expect(validateMessage("a".repeat(2001)).ok).toBe(false);
  });
});

describe("validateUsername", () => {
  it("accepts 3-20 chars of letters, digits, underscore", () => {
    expect(validateUsername("cool_kid7").ok).toBe(true);
  });
  it("rejects too short", () => {
    expect(validateUsername("ab").ok).toBe(false);
  });
  it("rejects spaces and symbols", () => {
    expect(validateUsername("bad name!").ok).toBe(false);
  });
});
```

Note: `@/*` import alias requires Vitest to resolve it. If the test fails to resolve `@/lib/...`, add `import tsconfigPaths from "vite-tsconfig-paths"` (install `-D vite-tsconfig-paths`) and `plugins: [tsconfigPaths()]` to `vitest.config.ts`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `validation.ts` / its exports don't exist yet.

- [ ] **Step 4: Implement `src/lib/validation.ts`**

```ts
export type Validated = { ok: true; value: string } | { ok: false; error: string };

export function validateMessage(input: string): Validated {
  const value = input.trim();
  if (value.length === 0) return { ok: false, error: "Message is empty" };
  if (value.length > 2000) return { ok: false, error: "Message too long (max 2000)" };
  return { ok: true, value };
}

export function validateUsername(input: string): Validated {
  const value = input.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(value)) {
    return { ok: false, error: "3–20 letters, numbers, or underscores only" };
  }
  return { ok: true, value };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 7 assertions green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/validation.ts tests/validation.test.ts
git commit -m "feat: add validated message/username helpers with tests"
```

---

## Task 7: Pure formatting logic (TDD)

**Files:**
- Create: `src/lib/format.ts`
- Test: `tests/format.test.ts`

- [ ] **Step 1: Write the failing test `tests/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatTime } from "@/lib/format";

describe("formatTime", () => {
  it("formats an ISO timestamp as HH:MM (24h)", () => {
    // 2026-05-22T09:05:00Z rendered in UTC
    expect(formatTime("2026-05-22T09:05:00Z", "UTC")).toBe("09:05");
  });
  it("pads single-digit minutes", () => {
    expect(formatTime("2026-05-22T23:07:00Z", "UTC")).toBe("23:07");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `formatTime` not defined.

- [ ] **Step 3: Implement `src/lib/format.ts`**

```ts
export function formatTime(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts tests/format.test.ts
git commit -m "feat: add timestamp formatting helper with tests"
```

---

## Task 8: Auth provider (current user + actions)

**Files:**
- Create: `src/components/providers/AuthProvider.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Write `src/components/providers/AuthProvider.tsx`**

```tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type AuthState = { user: User | null; loading: boolean; signOut: () => Promise<void> };
const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 2: Wrap the app in `src/app/layout.tsx`**

Replace the body's children render so the provider wraps everything:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";

export const metadata: Metadata = { title: "Chat", description: "Group chat" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#313338] text-[#dbdee1] antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify boot**

Run: `npm run dev`
Expected: starts, no errors. Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add src/components/providers/AuthProvider.tsx src/app/layout.tsx
git commit -m "feat: add auth provider exposing current user and signOut"
```

---

## Task 9: Register page

**Files:**
- Create: `src/app/register/page.tsx`

- [ ] **Step 1: Write `src/app/register/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { validateUsername } from "@/lib/validation";

export default function RegisterPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const u = validateUsername(username);
    if (!u.ok) return setError(u.error);
    setBusy(true);

    const { data, error: signErr } = await supabase.auth.signUp({ email, password });
    if (signErr || !data.user) {
      setBusy(false);
      return setError(signErr?.message ?? "Sign up failed");
    }
    const { error: profErr } = await supabase.from("profiles").insert({
      id: data.user.id,
      username: u.value,
      display_name: u.value,
    });
    if (profErr) {
      setBusy(false);
      return setError(profErr.message.includes("duplicate") ? "Username taken" : profErr.message);
    }
    router.push("/channels/general");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-[#2b2d31] p-6 rounded-lg space-y-3">
        <h1 className="text-xl font-bold text-white">Create account</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <input className="w-full p-2 rounded bg-[#1e1f22]" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="w-full p-2 rounded bg-[#1e1f22]" type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full p-2 rounded bg-[#1e1f22]" type="password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full p-2 rounded bg-[#5865f2] text-white font-medium disabled:opacity-50">
          {busy ? "Creating…" : "Register"}
        </button>
        <p className="text-sm text-[#949ba4]">
          Have an account? <Link href="/login" className="text-[#5865f2]">Log in</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run `npm run dev`, go to `http://localhost:3000/register`. Register with a real email + password (≥6 chars) + username. Expected: redirect to `/channels/general` (which 404s until Task 12 — that's fine). In Supabase → Table Editor → `profiles`, confirm a new row exists.

> Note: Supabase email confirmation. By default new projects may require email confirmation. For a small private app, disable it: Supabase dashboard → Authentication → Providers → Email → turn **off** "Confirm email". Do this now so registration logs the user straight in.

- [ ] **Step 3: Commit**

```bash
git add src/app/register/page.tsx
git commit -m "feat: add registration page creating auth user + profile"
```

---

## Task 10: Login page

**Files:**
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Write `src/app/login/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) return setError("Wrong email or password");
    router.push("/channels/general");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-[#2b2d31] p-6 rounded-lg space-y-3">
        <h1 className="text-xl font-bold text-white">Welcome back</h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <input className="w-full p-2 rounded bg-[#1e1f22]" type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full p-2 rounded bg-[#1e1f22]" type="password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full p-2 rounded bg-[#5865f2] text-white font-medium disabled:opacity-50">
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="text-sm text-[#949ba4]">
          New here? <Link href="/register" className="text-[#5865f2]">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

`npm run dev` → `/login`. Log in with the Task 9 account. Expected: redirect to `/channels/general` (still 404 until Task 12). Wrong password shows "Wrong email or password".

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: add login page"
```

---

## Task 11: App shell — auth guard + Sidebar

**Files:**
- Create: `src/app/(app)/layout.tsx`, `src/components/Sidebar.tsx`
- Create: `src/app/page.tsx` (root redirect)

- [ ] **Step 1: Write `src/app/page.tsx` (send people to the right place)**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/channels/general" : "/login");
  }, [user, loading, router]);
  return null;
}
```

Note: `/channels/general` uses the literal string `general` as the channel id slug. We resolve channels by **name** in Task 12, so this works without knowing the uuid.

- [ ] **Step 2: Write `src/components/Sidebar.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Channel, Profile } from "@/types/db";
import { NewDmDialog } from "@/components/NewDmDialog";

export function Sidebar() {
  const supabase = createClient();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<{ id: string; other: Profile }[]>([]);

  useEffect(() => {
    supabase.from("channels").select("*").order("position")
      .then(({ data }) => setChannels(data ?? []));
  }, [supabase]);

  useEffect(() => {
    if (!user) return;
    // conversations I'm in, plus the other member's profile
    (async () => {
      const { data: memberships } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", user.id);
      const convIds = (memberships ?? []).map((m) => m.conversation_id);
      if (convIds.length === 0) return setDms([]);
      const { data: others } = await supabase
        .from("conversation_members")
        .select("conversation_id, profiles(*)")
        .in("conversation_id", convIds)
        .neq("user_id", user.id);
      setDms(
        (others ?? []).map((o: any) => ({ id: o.conversation_id, other: o.profiles }))
      );
    })();
  }, [supabase, user]);

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <aside className="w-60 bg-[#2b2d31] flex flex-col">
      <div className="p-3 font-bold text-white border-b border-black/30">🏫 Our Server</div>
      <nav className="flex-1 overflow-y-auto p-2 text-[#949ba4]">
        <div className="text-xs uppercase mt-2 mb-1">Text Channels</div>
        {channels.map((c) => (
          <Link key={c.id} href={`/channels/${c.name}`}
            className="block px-2 py-1 rounded hover:bg-[#404249] hover:text-white">
            # {c.name}
          </Link>
        ))}
        <div className="flex items-center justify-between text-xs uppercase mt-4 mb-1">
          Direct Messages <NewDmDialog />
        </div>
        {dms.map((d) => (
          <Link key={d.id} href={`/dms/${d.id}`}
            className="block px-2 py-1 rounded hover:bg-[#404249] hover:text-white">
            ● {d.other?.display_name ?? "Unknown"}
          </Link>
        ))}
      </nav>
      <div className="p-2 bg-[#232428] flex items-center justify-between text-sm">
        <span className="text-white truncate">🟢 {user?.email}</span>
        <button onClick={onSignOut} className="text-[#949ba4] hover:text-white">Log out</button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Write `src/app/(app)/layout.tsx` (guard + 2-pane shell)**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) return <div className="p-6 text-[#949ba4]">Loading…</div>;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Temporarily stub `NewDmDialog` so the app compiles**

Create `src/components/NewDmDialog.tsx` with a placeholder that Task 14 replaces:
```tsx
"use client";
export function NewDmDialog() {
  return <span title="Coming in Task 14">＋</span>;
}
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/layout.tsx" src/components/Sidebar.tsx src/app/page.tsx src/components/NewDmDialog.tsx
git commit -m "feat: add auth-guarded app shell with sidebar"
```

---

## Task 12: Message components + realtime hook + channel page

**Files:**
- Create: `src/hooks/useMessages.ts`, `src/components/MessageList.tsx`, `src/components/MessageItem.tsx`, `src/components/MessageInput.tsx`
- Create: `src/app/(app)/channels/[channelId]/page.tsx`

- [ ] **Step 1: Write `src/hooks/useMessages.ts` (load history + subscribe)**

```ts
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types/db";

type Target = { channelId: string } | { conversationId: string };

export function useMessages(target: Target) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const column = "channelId" in target ? "channel_id" : "conversation_id";
  const value = "channelId" in target ? target.channelId : target.conversationId;

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq(column, value)
        .order("created_at", { ascending: true })
        .limit(200);
      // replace state from source of truth — covers both first load and reconnect,
      // and naturally de-dupes anything the INSERT handler already appended
      if (active) setMessages(data ?? []);
    }
    load();

    const channel = supabase
      .channel(`messages:${column}:${value}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) =>
          setMessages((prev) =>
            prev.some((m) => m.id === (payload.new as Message).id)
              ? prev
              : [...prev, payload.new as Message]
          )
      )
      .subscribe((status) => {
        // on (re)subscribe — including automatic reconnect after a drop —
        // reload recent history so no messages are missed during the gap
        if (status === "SUBSCRIBED") load();
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, column, value]);

  return messages;
}
```

- [ ] **Step 2: Write `src/components/MessageItem.tsx`**

```tsx
import type { Message } from "@/types/db";
import { formatTime } from "@/lib/format";

export function MessageItem({ msg, authorName }: { msg: Message; authorName: string }) {
  return (
    <div className="px-4 py-1 hover:bg-black/10">
      <span className="font-semibold text-white">{authorName}</span>
      <span className="text-xs text-[#949ba4] ml-2">{formatTime(msg.created_at)}</span>
      <div className="text-[#dbdee1] whitespace-pre-wrap break-words">{msg.content}</div>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/components/MessageList.tsx` (resolves author names, auto-scrolls)**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Profile } from "@/types/db";
import { MessageItem } from "@/components/MessageItem";

export function MessageList({ messages }: { messages: Message[] }) {
  const supabase = createClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const missing = [...new Set(messages.map((m) => m.author_id))].filter((id) => !names[id]);
    if (missing.length === 0) return;
    supabase.from("profiles").select("*").in("id", missing).then(({ data }) => {
      const next: Record<string, string> = {};
      (data as Profile[] | null)?.forEach((p) => (next[p.id] = p.display_name));
      setNames((prev) => ({ ...prev, ...next }));
    });
  }, [messages, names, supabase]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto py-3">
      {messages.map((m) => (
        <MessageItem key={m.id} msg={m} authorName={names[m.author_id] ?? "…"} />
      ))}
      <div ref={bottom} />
    </div>
  );
}
```

- [ ] **Step 4: Write `src/components/MessageInput.tsx` (send with validation + optimistic disable)**

```tsx
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { validateMessage } from "@/lib/validation";

type Target = { channel_id: string } | { conversation_id: string };

export function MessageInput({ target, placeholder }: { target: Target; placeholder: string }) {
  const supabase = createClient();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const v = validateMessage(text);
    if (!v.ok) return setError(v.error);
    setError(null);
    const draft = v.value;
    setText(""); // optimistic clear
    const { error: err } = await supabase
      .from("messages")
      .insert({ author_id: user!.id, content: draft, ...target });
    if (err) {
      setText(draft); // restore so the user can retry
      setError("Failed to send — try again");
    }
  }

  return (
    <form onSubmit={send} className="p-3">
      {error && <p className="text-red-400 text-sm mb-1">{error}</p>}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full p-2 rounded bg-[#383a40] text-[#dbdee1] outline-none"
      />
    </form>
  );
}
```

- [ ] **Step 5: Write `src/app/(app)/channels/[channelId]/page.tsx`**

The `[channelId]` segment carries the channel **name** (e.g. `general`). Resolve it to a row.

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";

export default function ChannelPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId: name } = use(params);
  const supabase = createClient();
  const [channel, setChannel] = useState<Channel | null>(null);

  useEffect(() => {
    supabase.from("channels").select("*").eq("name", name).single()
      .then(({ data }) => setChannel(data));
  }, [supabase, name]);

  if (!channel) return <div className="p-4 text-[#949ba4]">Loading channel…</div>;
  return <ChannelView channel={channel} />;
}

function ChannelView({ channel }: { channel: Channel }) {
  const messages = useMessages({ channelId: channel.id });
  return (
    <>
      <header className="p-3 border-b border-black/30 font-semibold text-white"># {channel.name}</header>
      <MessageList messages={messages} />
      <MessageInput target={{ channel_id: channel.id }} placeholder={`Message #${channel.name}`} />
    </>
  );
}
```

- [ ] **Step 6: Manual verification — the core test**

Run `npm run dev`. Log in. You should see the sidebar with #general/#homework/#memes and land in #general. Type a message and press Enter — it appears. **Open a second browser (or incognito), register/log in as a second user, open #general** — sending from one window makes the message appear in the other within ~1s. This validates the entire realtime path.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useMessages.ts src/components/MessageList.tsx src/components/MessageItem.tsx src/components/MessageInput.tsx "src/app/(app)/channels"
git commit -m "feat: realtime channel messaging end to end"
```

---

## Task 13: Direct message view

**Files:**
- Create: `src/app/(app)/dms/[conversationId]/page.tsx`

- [ ] **Step 1: Write `src/app/(app)/dms/[conversationId]/page.tsx`**

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";
import { useMessages } from "@/hooks/useMessages";
import { MessageList } from "@/components/MessageList";
import { MessageInput } from "@/components/MessageInput";

export default function DmPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = use(params);
  const supabase = createClient();
  const { user } = useAuth();
  const [other, setOther] = useState<Profile | null>(null);
  const messages = useMessages({ conversationId });

  useEffect(() => {
    if (!user) return;
    supabase
      .from("conversation_members")
      .select("profiles(*)")
      .eq("conversation_id", conversationId)
      .neq("user_id", user.id)
      .single()
      .then(({ data }: any) => setOther(data?.profiles ?? null));
  }, [supabase, conversationId, user]);

  return (
    <>
      <header className="p-3 border-b border-black/30 font-semibold text-white">
        @ {other?.display_name ?? "Direct Message"}
      </header>
      <MessageList messages={messages} />
      <MessageInput
        target={{ conversation_id: conversationId }}
        placeholder={`Message ${other?.display_name ?? ""}`}
      />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/dms"
git commit -m "feat: add direct message view"
```

---

## Task 14: Start a DM (NewDmDialog)

**Files:**
- Modify: `src/components/NewDmDialog.tsx` (replace the Task 11 stub)

- [ ] **Step 1: Replace `src/components/NewDmDialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { Profile } from "@/types/db";

export function NewDmDialog() {
  const supabase = createClient();
  const router = useRouter();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Profile[]>([]);

  async function search(q: string) {
    if (q.length < 2) return setResults([]);
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .ilike("username", `%${q}%`)
      .neq("id", user!.id)
      .limit(10);
    setResults((data as Profile[]) ?? []);
  }

  async function startDm(other: Profile) {
    // find an existing 1-on-1 conversation with this person, else create one
    const { data: mine } = await supabase
      .from("conversation_members").select("conversation_id").eq("user_id", user!.id);
    const myIds = (mine ?? []).map((m) => m.conversation_id);
    let convId: string | null = null;
    if (myIds.length) {
      const { data: shared } = await supabase
        .from("conversation_members")
        .select("conversation_id")
        .eq("user_id", other.id)
        .in("conversation_id", myIds);
      convId = shared?.[0]?.conversation_id ?? null;
    }
    if (!convId) {
      const { data: conv } = await supabase
        .from("conversations").insert({ is_group: false }).select("id").single();
      convId = conv!.id;
      await supabase.from("conversation_members").insert([
        { conversation_id: convId, user_id: user!.id },
        { conversation_id: convId, user_id: other.id },
      ]);
    }
    setOpen(false);
    router.push(`/dms/${convId}`);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-[#949ba4] hover:text-white" title="New DM">＋</button>
      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
             onClick={() => setOpen(false)}>
          <div className="bg-[#2b2d31] p-4 rounded-lg w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-white font-semibold mb-2">Start a DM</h2>
            <input autoFocus placeholder="Search username…"
              className="w-full p-2 rounded bg-[#1e1f22] text-[#dbdee1]"
              onChange={(e) => search(e.target.value)} />
            <ul className="mt-2 max-h-60 overflow-y-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button onClick={() => startDm(p)}
                    className="w-full text-left px-2 py-1 rounded hover:bg-[#404249] text-[#dbdee1]">
                    {p.display_name} <span className="text-[#949ba4]">@{p.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Manual verification — DM flow**

With two registered users in two browsers: in user A's window click ＋ next to Direct Messages, search user B's username, click them. A DM opens. Send a message; confirm it appears live in user B's window when B opens the DM (it shows in B's sidebar after refresh — live sidebar updates are a later sub-project). Re-opening the dialog and picking the same person reuses the existing conversation (no duplicate).

- [ ] **Step 3: Commit**

```bash
git add src/components/NewDmDialog.tsx
git commit -m "feat: start or reuse a 1-on-1 DM conversation"
```

---

## Task 15: Final checks and deploy

**Files:** none (config + hosting)

- [ ] **Step 1: Run the full test + build locally**

Run:
```bash
npm test
npm run build
```
Expected: tests PASS; build completes with no type errors. Fix any reported type/lint errors before continuing.

- [ ] **Step 2: Push to GitHub**

Create a GitHub repo (private). Then:
```bash
git remote add origin git@github.com:YOURNAME/school-chat.git
git push -u origin main
```

- [ ] **Step 3: Import to Vercel**

In Vercel → "Add New… → Project" → import the GitHub repo. Framework preset: Next.js (auto). **Add environment variables** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same values as `.env.local`). Deploy.

- [ ] **Step 4: Smoke-test production**

Open the Vercel URL. Register a fresh account, post in #general, open a second browser and confirm live delivery, start a DM. If realtime doesn't work in production, confirm in Supabase → Database → Replication that the `messages` table is in the `supabase_realtime` publication (the migration added it).

- [ ] **Step 5: Run the full manual checklist (from the spec)**

register → log in → post in #general → confirm it appears on a second browser → open a DM → send and receive → log out. All must pass.

- [ ] **Step 6: Tag the release**

```bash
git tag -a v0.1-foundation -m "Foundation MVP: auth, channels, realtime messaging, DMs"
git push --tags
```

---

## Done criteria

- Users can register, log in, and log out.
- The shared server shows seeded text channels; messages send and appear live for all viewers.
- Users can start a 1-on-1 DM and exchange messages.
- RLS prevents reading other users' DMs.
- Unit tests pass; the app is deployed and smoke-tested in production.

When this is complete, the next sub-project (Rich messaging: edit/delete, reactions, markdown, uploads) gets its own brainstorm → spec → plan cycle.
