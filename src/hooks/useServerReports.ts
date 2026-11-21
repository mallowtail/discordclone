"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { REPORT_SELECT, sortReports, type ReportRow } from "@/lib/reports/reports";

/**
 * Message reports about this server that I may see (row-level security decides: View Reports
 * holders, minus reports about people who hold View Reports there; the site admin sees them all).
 * Only fetched when `enabled`; kept fresh by realtime so the open-count badge updates live.
 */
export function useServerReports(serverId: string, enabled: boolean): {
  reports: ReportRow[] | null;
  error: boolean;
  reload: () => void;
} {
  const supabase = useMemo(() => createClient(), []);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [error, setError] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    const { data, error: err } = await supabase.from("reports").select(REPORT_SELECT)
      .eq("server_id", serverId).eq("kind", "message")
      .order("created_at", { ascending: false }).limit(200);
    if (my !== seq.current) return; // a newer load superseded this one
    if (err) return setError(true);
    setError(false);
    setReports(sortReports((data as unknown as ReportRow[] | null) ?? []));
  }, [supabase, serverId]);

  const instanceId = useId();
  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after its await (fetch-on-mount)
    load();
    const channel = supabase
      .channel(`reports:${serverId}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reports", filter: `server_id=eq.${serverId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, serverId, enabled, load, instanceId]);

  return { reports: enabled ? reports : null, error, reload: load };
}
