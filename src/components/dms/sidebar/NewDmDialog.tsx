"use client";

import { useState } from "react";
import { PeoplePickerDialog } from "@/components/dms/sidebar/PeoplePickerDialog";
import { Plus } from "@phosphor-icons/react";

/** The + next to "Direct Messages": start a DM or a group with people you can already reach. */
export function NewDmDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-muted hover:text-ink" title="New DM or group" aria-label="New DM or group">
        <Plus size={18} weight="bold" />
      </button>
      {open && <PeoplePickerDialog mode="new" onClose={() => setOpen(false)} />}
    </>
  );
}
