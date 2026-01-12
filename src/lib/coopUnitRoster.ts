import { supabase } from "@/integrations/supabase/client";

export interface CoopUnitRosterUnit {
  unit: string;
  count: number;
  lastSeen: string | null;
  source: string;
}

export type CoopUnitRosterResult =
  | {
      units: CoopUnitRosterUnit[];
      error: null;
      warning?: string;
      requestId?: string;
      bbl?: string;
    }
  | {
      units: CoopUnitRosterUnit[];
      error: "missing_bbl" | "request_failed";
      warning?: string;
      requestId?: string;
      bbl?: string;
    };

export async function fetchCoopUnitRoster(params: {
  bbl?: string;
  limit?: number;
  offset?: number;
}): Promise<CoopUnitRosterResult> {
  const bbl = String(params.bbl ?? "").trim();
  const limit = params.limit ?? 200;
  const offset = params.offset ?? 0;

  if (!bbl || bbl.length !== 10) {
    return { units: [], error: "missing_bbl" };
  }

  const url = `/functions/v1/coop-unit-roster?bbl=${encodeURIComponent(bbl)}&limit=${encodeURIComponent(
    String(limit)
  )}&offset=${encodeURIComponent(String(offset))}`;

  try {
    // Note: We intentionally use query params so the request is debuggable in network logs.
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return {
        units: [],
        error: "request_failed",
        warning: data?.userMessage || data?.error || `HTTP ${res.status}`,
        requestId: data?.requestId,
        bbl,
      };
    }

    if (!data || typeof data !== "object") {
      return { units: [], error: "request_failed", warning: "Invalid response", bbl };
    }

    return {
      units: (data.units as CoopUnitRosterUnit[]) || [],
      error: null,
      warning: data.warning,
      requestId: data.requestId,
      bbl: data.bbl,
    };
  } catch (e) {
    return {
      units: [],
      error: "request_failed",
      warning: e instanceof Error ? e.message : "Network error",
      bbl,
    };
  }
}
