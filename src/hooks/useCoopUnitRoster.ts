import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
    if (!bbl || bbl.length !== 10) {
      setError('Invalid BBL');
      return;
    }

    // Don't refetch if same BBL
    if (lastBblRef.current === bbl && data) {
      return;
    }

    setLoading(true);
    setError(null);
    lastBblRef.current = bbl;

    try {
      const { data: responseData, error: invokeError } = await supabase.functions.invoke(
        'coop-unit-roster',
        {
          body: { bbl, limit: 200 },
        }
      );

      if (invokeError) {
        throw new Error(invokeError.message || 'Failed to fetch unit roster');
      }

      // Handle edge function error responses
      if (responseData?.error) {
        throw new Error(responseData.userMessage || responseData.error);
      }

      setData(responseData as CoopUnitRosterResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
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
