import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { safeNext } from "@/lib/servers/invite";
import { BANNED_NOTICE_KEY, isBannedLoginError } from "@/lib/users/account";

// Google/GitHub/Discord send the browser back here with ?code=…. We trade the code for a session
// (createServerSupabase's cookie adapter writes the auth cookies onto this response), then send
// anyone without a profile row yet to /welcome to pick a username — OAuth skips the register form,
// which is where email sign-ups get their profile.
/** To /login with the banned message (flagged by a one-minute cookie that /login reads and clears). */
function toBannedLogin(origin: string) {
  const res = NextResponse.redirect(new URL("/login?banned=1", origin));
  res.cookies.set(BANNED_NOTICE_KEY, "1", { path: "/login", maxAge: 60, sameSite: "lax" });
  return res;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  // Supabase refuses a banned account before handing out a code, coming back with
  // ?error=…&error_code=user_banned&error_description=User+is+banned.
  const refused = { code: url.searchParams.get("error_code"), message: url.searchParams.get("error_description") };
  if (isBannedLoginError(refused)) return toBannedLogin(url.origin);

  if (code) {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", data.user.id)
        .maybeSingle();
      const dest = profile ? next : `/welcome?next=${encodeURIComponent(next)}`;
      return NextResponse.redirect(new URL(dest, url.origin));
    }
    if (isBannedLoginError(error)) return toBannedLogin(url.origin);
  }

  // No code (the user cancelled at the provider) or the exchange failed.
  return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
}
