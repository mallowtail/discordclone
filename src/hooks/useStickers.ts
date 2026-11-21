"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Sticker } from "@/lib/messages/stickers";

/** Every sticker from the servers you're in (RLS limits the rows), refetched each time `enabled` turns on. */
export function useStickers(enabled: boolean): { stickers: Sticker[]; loading: boolean } {
  const supabase = useMemo(() => createClient(), []);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start the fetch when the picker opens
    setLoading(true);
    supabase.from("stickers").select("*").order("created_at").then(({ data }) => {
      if (cancelled) return;
      setStickers((data as Sticker[] | null) ?? []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [supabase, enabled]);

  return { stickers, loading };
}
