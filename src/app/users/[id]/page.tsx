"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { FullProfileModal } from "@/components/user/FullProfileModal";

export default function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=/users/${id}`);
  }, [loading, user, id, router]);

  if (loading || !user) return <div className="min-h-screen bg-app" />;

  // Deep-linked full profile: render the same modal over the app background.
  return (
    <div className="min-h-screen bg-app">
      <FullProfileModal userId={id} onClose={() => router.push("/")} />
    </div>
  );
}
