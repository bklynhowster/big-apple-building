import { useCallback, useState } from 'react';
import { parseApiError, type ApiError } from '@/types/api-error';

export interface CondoUnit {
  unitBbl: string;
  borough: string;
  block: string;
  lot: string;
  unitLabel: string | null;
  raw: Record<string, unknown>;
}

export interface CondoUnitsResponse {
  inputBbl: string;
  billingBbl: string | null;
  inputIsUnitLot: boolean;
  isCondo: boolean;
  units: CondoUnit[];
  totalApprox: number;
  requestId: string;
}

interface UseCondoUnitsReturn {
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  data: CondoUnitsResponse | null;
  fetchFirstPage: (bbl: string, pageSize?: number) => Promise<void>;
  fetchNextPage: (pageSize?: number) => Promise<void>;
  retry: () => void;
}

const cache = new Map<string, { data: CondoUnitsResponse; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function useCondoUnits(): UseCondoUnitsReturn {
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<CondoUnitsResponse | null>(null);
  const [currentBbl, setCurrentBbl] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(200);

  const fetchPage = useCallback(async (
    bbl: string,
    offset: number,
    limit: number,
    append: boolean
  ) => {
    const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/condo-units`;
    const url = `${baseUrl}?bbl=${encodeURIComponent(bbl)}&limit=${limit}&offset=${offset}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    });

    if (!response.ok) {
      throw await parseApiError(response);
    }

    const result: CondoUnitsResponse = await response.json();

    setData((prev) => {
      if (!append || !prev || prev.inputBbl !== result.inputBbl) {
        return result;
      }

      const existing = new Map(prev.units.map((u) => [u.unitBbl, u]));
      for (const u of result.units) existing.set(u.unitBbl, u);

      return {
        ...prev,
        billingBbl: result.billingBbl,
        inputIsUnitLot: result.inputIsUnitLot,
        isCondo: result.isCondo,
        totalApprox: result.totalApprox,
        requestId: result.requestId,
        units: Array.from(existing.values()).sort((a, b) => a.unitBbl.localeCompare(b.unitBbl)),
      };
    });

    if (!append) {
      cache.set(bbl, { data: result, timestamp: Date.now() });
    }
  }, []);

  const fetchFirstPage = useCallback(async (bbl: string, pageSizeOverride?: number) => {
    if (!bbl || bbl.length !== 10) {
      setError({
        error: 'Invalid BBL',
        details: 'BBL validation failed',
        userMessage: 'BBL must be exactly 10 digits.',
        requestId: 'validation',
      });
      return;
    }

    const limit = pageSizeOverride || pageSize;
    setPageSize(limit);

    const cached = cache.get(bbl);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setData(cached.data);
      setError(null);
      setCurrentBbl(bbl);
      return;
    }

    setLoading(true);
    setError(null);
    setCurrentBbl(bbl);

    try {
      await fetchPage(bbl, 0, limit, false);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fetchPage, pageSize]);

  const fetchNextPage = useCallback(async (pageSizeOverride?: number) => {
    if (!currentBbl || !data) return;
    if (!data.isCondo) return;

    const limit = pageSizeOverride || pageSize;
    const offset = data.units.length;

    if (data.totalApprox > 0 && offset >= data.totalApprox) return;

    setLoadingMore(true);
    setError(null);

    try {
      await fetchPage(currentBbl, offset, limit, true);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError);
    } finally {
      setLoadingMore(false);
    }
  }, [currentBbl, data, fetchPage, pageSize]);

  const retry = useCallback(() => {
    if (currentBbl) {
      cache.delete(currentBbl);
      fetchFirstPage(currentBbl);
    }
  }, [currentBbl, fetchFirstPage]);

  return {
    loading,
    loadingMore,
    error,
    data,
    fetchFirstPage,
    fetchNextPage,
    retry,
  };
}
