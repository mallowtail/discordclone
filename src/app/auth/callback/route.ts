import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { safeNext } from "@/lib/invite";

// Google/GitHub/Discord send the browser back here with ?code=…. We trade the code for a session
// (createServerSupabase's cookie adapter writes the auth cookies onto this response), then send
// anyone without a profile row yet to /welcome to pick a username — OAuth skips the register form,
// which is where email sign-ups get their profile.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

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
  }

  // No code (the user cancelled at the provider) or the exchange failed.
  return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
}
