"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { PresenceProvider } from "@/components/providers/PresenceProvider";
import { FullProfileModal } from "@/components/user/FullProfileModal";

export default function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=/users/${id}`);
  }, [loading, user, id, router]);

  if (loading || !user) return <div className="min-h-screen bg-app" />;

  // Deep-linked full profile: render the same modal over the app background. This route sits
  // outside (app)/layout.tsx's tree (and so outside its PresenceProvider), so it mounts its own
  // — disjoint route trees never render both at once in the same tab, and even if a user had
  // this route open in one tab and the main app in another, Realtime Presence supports multiple
  // concurrent trackers under the same key (e.g. multi-tab/multi-device), so they wouldn't
  // conflict.
  return (
    <PresenceProvider>
      <div className="min-h-screen bg-app">
        <FullProfileModal userId={id} onClose={() => router.push("/")} />
      </div>
    </PresenceProvider>
  );
}
