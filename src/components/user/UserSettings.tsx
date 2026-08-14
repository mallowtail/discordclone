"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { ProfileSection } from "@/components/user/settings/ProfileSection";
import { AccountSection } from "@/components/user/settings/AccountSection";
import { X } from "@phosphor-icons/react";

type Section = "profile" | "account";

export function UserSettings({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [section, setSection] = useState<Section>("profile");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function logOut() {
    await signOut();
    router.replace("/login");
  }

  const navItem = (id: Section, label: string) => (
    <button
      onClick={() => setSection(id)}
      className={`w-full text-left text-sm rounded-lg px-3 py-1.5 ${
        section === id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-app flex">
      <nav className="w-56 bg-sidebar border-r border-line flex flex-col p-3 gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted px-3 py-2">
          User Settings
        </div>
        {navItem("profile", "Profile")}
        {navItem("account", "Account")}
        <button
          onClick={logOut}
          className="mt-auto w-full text-left text-sm rounded-lg px-3 py-1.5 text-danger hover:bg-surface-2"
        >
          Log Out
        </button>
      </nav>

      <div className="flex-1 relative overflow-y-auto">
        <button
          onClick={onClose}
          title="Close (Esc)"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-surface-2"
        >
          <X size={18} weight="bold" />
        </button>
        <div className="p-8">
          {section === "profile" ? <ProfileSection /> : <AccountSection />}
        </div>
      </div>
    </div>
  );
}
