# Friends Chat

A Discord-style chat app built for a group of about 30 school friends. It has servers with channels, direct messages, roles and permissions, moderation tools, message search, reactions, pinned messages, invite links, online presence, and typing indicators.

## Tech stack

- **Next.js 16** (React) for the website
- **Supabase** for the database (Postgres), sign-in (Auth), live updates (Realtime), and file uploads (Storage)
- **Vercel** for hosting

## Running it on your computer

1. Install the packages:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
3. Open `.env.local` and fill in the two values from your Supabase dashboard (Settings, then API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Start the dev server:
   ```bash
   npm run dev
   ```
5. Open http://localhost:3000 in your browser.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm test` | Runs the automated tests |
| `npm run lint` | Checks the code for common mistakes and style problems |
| `npx tsc --noEmit` | Checks the TypeScript types |
| `npm run build` | Makes a production build, like Vercel does |

## Database changes (migrations)

The database setup lives as numbered SQL files in `supabase/migrations/`. To apply new ones to your Supabase project, run:

```bash
npx supabase db push
```

This changes the real database, so read the new SQL file before you run it.

## Where the plans live

Design specs and implementation plans are in `docs/superpowers/` (`specs/` for what we decided to build, `plans/` for the step-by-step tasks).
