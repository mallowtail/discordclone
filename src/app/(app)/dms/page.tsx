"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { ChatCircleDots } from "@phosphor-icons/react";

export default function DmHome() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <EmptyState
        icon={<ChatCircleDots size={32} weight="bold" aria-hidden="true" />}
        title="No conversation open"
        description="Pick a server on the left, add one with the add-server button, or start a direct message."
      />
    </div>
  );
}
