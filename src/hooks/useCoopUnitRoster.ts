import { useState, useCallback, useRef } from 'react';
import { fetchCoopUnitRoster } from '@/lib/coopUnitRoster';

export interface UnitRosterEntry {
  unit: string;
  count: number;
  lastSeen: string | null;
  source: string;
}

export interface CoopUnitRosterResponse {
  bbl: string;
  units: UnitRosterEntry[];
  totalRecordsScanned: number;
  warning?: string;
  requestId: string;
}

export interface UseCoopUnitRosterReturn {
  loading: boolean;
  error: string | null;
  data: CoopUnitRosterResponse | null;
  units: UnitRosterEntry[];
  warning: string | null;
  fetch: (bbl: string) => Promise<void>;
  reset: () => void;
}

export function useCoopUnitRoster(): UseCoopUnitRosterReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CoopUnitRosterResponse | null>(null);

  const lastBblRef = useRef<string | null>(null);

  const fetchData = useCallback(async (bbl: string) => {
    const normalizedBbl = String(bbl || '').trim().padStart(10, '0');

    // Strict guard: never call without a known building BBL
    if (!normalizedBbl || normalizedBbl.length !== 10) {
      setError('Unit roster unavailable: building identifier (BBL) not loaded.');
      setData(null);
      return;
    }

    // Don't refetch if same BBL
    if (lastBblRef.current === normalizedBbl && data) {
      return;
    }

    setLoading(true);
    setError(null);
    lastBblRef.current = normalizedBbl;

    const result = await fetchCoopUnitRoster({ bbl: normalizedBbl, limit: 200, offset: 0 });

    if (result.error === 'missing_bbl') {
      setError('Unit roster unavailable: building identifier (BBL) not loaded.');
      setData(null);
      setLoading(false);
      return;
    }

    if (result.error) {
      setError(result.warning || 'Unit roster unavailable');
      setData(null);
      setLoading(false);
      return;
    }

    // Adapt response into the existing shape
    setData({
      bbl: result.bbl || normalizedBbl,
      units: result.units,
      // We don't currently return this from the endpoint; keep as 0 for UI.
      totalRecordsScanned: 0,
      warning: result.warning,
      requestId: result.requestId || 'unknown',
    });

    setLoading(false);
  }, [data]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(null);
    lastBblRef.current = null;
  }, []);

  return {
    loading,
    error,
    data,
    units: data?.units || [],
    warning: data?.warning || null,
    fetch: fetchData,
    reset,
  };
}
