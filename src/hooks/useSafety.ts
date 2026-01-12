import { useState, useEffect, useRef, useCallback } from 'react';
import { parseApiError, type ApiError } from '@/types/api-error';
import { useTrackedFetch } from '@/hooks/useTrackedFetch';

interface SafetyViolation {
  recordType: 'Safety';
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  raw: Record<string, unknown>;
}

interface SafetyResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: SafetyViolation[];
  nextOffset: number | null;
  requestId?: string;
}

interface UseSafetyOptions {
  bbl: string;
  limit?: number;
  offset?: number;
  fromDate?: string;
  toDate?: string;
  status?: 'open' | 'closed' | 'all';
}

interface UseSafetyResult {
  loading: boolean;
  error: ApiError | null;
  data: SafetyResponse | null;
  items: SafetyViolation[];
  blocked: boolean;
  refetch: () => void;
}

// Simple in-memory cache
const cache = new Map<string, { data: SafetyResponse; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function useSafety(options: UseSafetyOptions): UseSafetyResult {
  const { bbl, limit = 50, offset = 0, fromDate, toDate, status = 'all' } = options;
  const blocked = !bbl || bbl.length !== 10;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<SafetyResponse | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { trackedFetch } = useTrackedFetch({ endpoint: 'dob-safety', dataset: 'DOB Safety' });

  const cacheKey = `${bbl}-${limit}-${offset}-${fromDate || ''}-${toDate || ''}-${status}`;

  const fetchData = useCallback(async () => {
    if (blocked) {
      setError(null);
      setLoading(false);
      return;
    }

    // Check cache
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string> = {
        bbl,
        limit: String(limit),
        offset: String(offset),
        status,
      };

      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;

      const urlParams = new URLSearchParams(params);
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dob-safety`;
      const fullUrl = `${baseUrl}?${urlParams.toString()}`;

      const response = await trackedFetch(fullUrl, params, {
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const apiError = await parseApiError(response);
        setError(apiError);
        setData(null);
        return;
      }

      const result: SafetyResponse = await response.json();
      cache.set(cacheKey, { data: result, timestamp: Date.now() });
      setData(result);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Error fetching safety data:', err);
      setError({
        error: 'Network error',
        details: err instanceof Error ? err.message : 'Unknown error',
        userMessage: 'Unable to connect to the server. Please check your connection and try again.',
        requestId: 'unknown',
      });
    } finally {
      setLoading(false);
    }
  }, [bbl, limit, offset, fromDate, toDate, status, cacheKey, blocked, trackedFetch]);

  useEffect(() => {
    fetchData();
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [fetchData]);

  return {
    loading: blocked ? false : loading,
    error: blocked ? null : error,
    data: blocked ? null : data,
    items: blocked ? [] : (data?.items || []),
    blocked,
    refetch: fetchData,
  };
}

export function clearSafetyCache() {
  cache.clear();
}