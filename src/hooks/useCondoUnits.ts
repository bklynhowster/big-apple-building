import { useState, useCallback } from 'react';
import { parseApiError, type ApiError } from '@/types/api-error';

export interface CondoUnit {
  unitBbl: string;
  borough: string;
  block: string;
  lot: string;
  unitLabel: string | null;
  address: string | null;
  raw: Record<string, unknown>;
}

export interface CondoUnitsResponse {
  buildingBbl: string;
  isCondo: boolean;
  buildingContextBbl: string | null;
  billingLotBbl: string | null;
  condoId: string | null;
  units: CondoUnit[];
  totalApprox: number;
  notes: string[];
  requestId: string;
}

interface UseCondoUnitsReturn {
  loading: boolean;
  error: ApiError | null;
  data: CondoUnitsResponse | null;
  fetch: (bbl: string) => Promise<void>;
  retry: () => void;
}

// Simple cache
const cache = new Map<string, { data: CondoUnitsResponse; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export function useCondoUnits(): UseCondoUnitsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<CondoUnitsResponse | null>(null);
  const [currentBbl, setCurrentBbl] = useState<string | null>(null);

  const fetchCondoUnits = useCallback(async (bbl: string) => {
    if (!bbl || bbl.length !== 10) {
      setError({
        error: 'Invalid BBL',
        details: 'BBL validation failed',
        userMessage: 'BBL must be exactly 10 digits.',
        requestId: 'validation',
      });
      return;
    }

    // Check cache
    const cached = cache.get(bbl);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setData(cached.data);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setCurrentBbl(bbl);

    try {
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/condo-units`;
      const url = `${baseUrl}?buildingBbl=${encodeURIComponent(bbl)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });

      if (!response.ok) {
        const apiError = await parseApiError(response);
        setError(apiError);
        setData(null);
        return;
      }

      const result: CondoUnitsResponse = await response.json();
      cache.set(bbl, { data: result, timestamp: Date.now() });
      setData(result);
    } catch (err) {
      console.error('Error fetching condo units:', err);
      setError({
        error: 'Network error',
        details: err instanceof Error ? err.message : 'Unknown error',
        userMessage: 'Unable to connect to the server. Please check your connection and try again.',
        requestId: 'unknown',
      });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(() => {
    if (currentBbl) {
      // Clear cache for retry
      cache.delete(currentBbl);
      fetchCondoUnits(currentBbl);
    }
  }, [currentBbl, fetchCondoUnits]);

  return {
    loading,
    error,
    data,
    fetch: fetchCondoUnits,
    retry,
  };
}
