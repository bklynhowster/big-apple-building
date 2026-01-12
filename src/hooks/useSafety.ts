import { useState, useEffect, useRef, useCallback } from 'react';

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
  error: string | null;
  data: SafetyResponse | null;
  refetch: () => void;
}

// Simple in-memory cache
const cache = new Map<string, { data: SafetyResponse; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function useSafety(options: UseSafetyOptions): UseSafetyResult {
  const { bbl, limit = 50, offset = 0, fromDate, toDate, status = 'all' } = options;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SafetyResponse | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cacheKey = `${bbl}-${limit}-${offset}-${fromDate || ''}-${toDate || ''}-${status}`;

  const fetchData = useCallback(async () => {
    if (!bbl || bbl.length !== 10) {
      setError('Valid 10-digit BBL is required');
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
      const params = new URLSearchParams({
        bbl,
        limit: String(limit),
        offset: String(offset),
        status,
      });

      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);

      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dob-safety`;
      const response = await fetch(`${baseUrl}?${params.toString()}`, {
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result: SafetyResponse = await response.json();
      
      // Update cache
      cache.set(cacheKey, { data: result, timestamp: Date.now() });
      
      setData(result);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return; // Ignore aborted requests
      }
      console.error('Error fetching safety data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch safety data');
    } finally {
      setLoading(false);
    }
  }, [bbl, limit, offset, fromDate, toDate, status, cacheKey]);

  useEffect(() => {
    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData]);

  return { loading, error, data, refetch: fetchData };
}

// Export cache clear function for when BBL changes
export function clearSafetyCache() {
  cache.clear();
}
