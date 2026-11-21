import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ChatsCircle, Hash, Smiley, SpeakerHigh, ShieldCheck, UserCircleGear } from "@phosphor-icons/react/ssr";
import { createServerSupabase } from "@/lib/supabase/server";
import { SignedInRedirect } from "@/components/home/SignedInRedirect";

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <Hash size={22} weight="bold" />, title: "Servers & channels", text: "Make a server for your group, with text and voice channels, roles and invite links." },
  { icon: <ChatsCircle size={22} weight="bold" />, title: "DMs & group chats", text: "Talk one-on-one, or start a group chat with a few friends." },
  { icon: <SpeakerHigh size={22} weight="bold" />, title: "Voice chat & screen sharing", text: "Hop into a voice channel or call a friend, and share your screen." },
  { icon: <Smiley size={22} weight="bold" />, title: "GIFs, stickers & emoji", text: "Search GIFs, add your server's own stickers, and react with emoji." },
  { icon: <UserCircleGear size={22} weight="bold" />, title: "Privacy controls", text: "Choose who can message you or add you as a friend. Block or ignore anyone." },
  { icon: <ShieldCheck size={22} weight="bold" />, title: "Reports & moderation", text: "Report a message, and moderators can step in — bans, timeouts and an audit log." },
];

/**
 * `/`: signed-in people go straight to their chats (decided on the server from the session cookie,
 * so the landing page never flashes for them); everyone else sees what Mallowchat is, with
 * Log in / Sign up. A first OAuth sign-in without a username yet is sent on from the app to /welcome.
 */
export default async function Home() {
  let signedIn = false;
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims?.sub;
  } catch {
    // No usable session (or Auth unreachable): show the front page; SignedInRedirect still
    // moves on if the browser turns out to have a session.
  }
  // Outside the try: redirect() works by throwing.
  if (signedIn) redirect("/channels/first");

  return (
    <div className="min-h-screen bg-app px-4 py-12 sm:py-20">
      <SignedInRedirect />
      <main className="mx-auto max-w-3xl">
        <section className="flex flex-col items-center text-center">
          <svg width="64" height="64" viewBox="0 0 32 32" aria-hidden="true">
            <path fill="var(--color-accent)" d="M9 7h14a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-7l-5.5 4.5a.6.6 0 0 1-1-.46V23H9a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z" />
            <circle cx="12" cy="15" r="1.7" fill="var(--color-app)" />
            <circle cx="16" cy="15" r="1.7" fill="var(--color-app)" />
            <circle cx="20" cy="15" r="1.7" fill="var(--color-app)" />
          </svg>
          <h1 className="mt-4 text-3xl sm:text-4xl font-semibold text-ink tracking-tight">Mallowchat</h1>
          <p className="mt-3 max-w-md text-body sm:text-title text-muted">
            A cozy place to chat with your friends — servers, group chats and voice, all in your browser.
          </p>
          <div className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:w-auto sm:flex-row">
            <Link href="/login"
              className="inline-flex items-center justify-center min-h-11 px-6 rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium">
              Log in
            </Link>
            <Link href="/register"
              className="inline-flex items-center justify-center min-h-11 px-6 rounded-control bg-surface border border-line hover:bg-surface-2 text-ink text-body font-medium">
              Sign up
            </Link>
          </div>
        </section>

        <section aria-labelledby="features" className="mt-14 sm:mt-20">
          <h2 id="features" className="sr-only">What you can do</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-card border border-line bg-surface p-4">
                <div className="flex items-center gap-2 text-accent" aria-hidden="true">{f.icon}</div>
                <h3 className="mt-2 text-title font-semibold text-ink">{f.title}</h3>
                <p className="mt-1 text-meta text-muted">{f.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
