import { useState, useCallback, useRef } from 'react';
import { parseApiError, type ApiError } from '@/types/api-error';

export interface ViolationRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'resolved' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  raw: Record<string, unknown>;
}

export interface ViolationsApiResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: ViolationRecord[];
  nextOffset: number | null;
  requestId?: string;
}

export interface ViolationsFilters {
  status: 'all' | 'open' | 'resolved';
  fromDate?: string;
  toDate?: string;
  keyword?: string;
}

export interface UseViolationsReturn {
  loading: boolean;
  error: ApiError | null;
  data: ViolationsApiResponse | null;
  items: ViolationRecord[];
  blocked: boolean;
  filters: ViolationsFilters;
  offset: number;
  fetchViolations: (bbl: string) => Promise<void>;
  setFilters: (filters: ViolationsFilters) => void;
  applyFilters: () => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  reset: () => void;
  retry: () => void;
}

const DEFAULT_LIMIT = 50;

export function useViolations(bbl?: string | null): UseViolationsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<ViolationsApiResponse | null>(null);
  const [filters, setFilters] = useState<ViolationsFilters>({
    status: 'all',
    keyword: '',
  });
  const [appliedFilters, setAppliedFilters] = useState<ViolationsFilters>({
    status: 'all',
    keyword: '',
  });
  const [offset, setOffset] = useState(0);
  const [currentBBL, setCurrentBBL] = useState<string | null>(null);
  const loggedUrlsRef = useRef<Set<string>>(new Set());

  const blocked = !bbl || bbl.length !== 10;

  const fetchViolations = useCallback(async (targetBBL: string, targetOffset = 0, targetFilters?: ViolationsFilters) => {
    if (!targetBBL || targetBBL.length !== 10) return;

    setLoading(true);
    setError(null);
    setCurrentBBL(targetBBL);

    const filtersToUse = targetFilters || appliedFilters;

    try {
      const queryParams: Record<string, string> = {
        bbl: targetBBL,
        limit: String(DEFAULT_LIMIT),
        offset: String(targetOffset),
      };

      if (filtersToUse.status !== 'all') queryParams.status = filtersToUse.status;
      if (filtersToUse.fromDate) queryParams.fromDate = filtersToUse.fromDate;
      if (filtersToUse.toDate) queryParams.toDate = filtersToUse.toDate;
      if (filtersToUse.keyword) queryParams.q = filtersToUse.keyword;

      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dob-violations`;
      const urlParams = new URLSearchParams(queryParams);
      const fullUrl = `${baseUrl}?${urlParams.toString()}`;

      if (!loggedUrlsRef.current.has(fullUrl)) {
        console.log('[useViolations] fetching:', fullUrl);
        loggedUrlsRef.current.add(fullUrl);
      }

      const response = await fetch(fullUrl, {
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

      const result: ViolationsApiResponse = await response.json();
      setData(result);
      setOffset(targetOffset);
    } catch (err) {
      console.error('Error fetching violations:', err);
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
  }, [appliedFilters]);

  const applyFilters = useCallback(() => {
    setAppliedFilters(filters);
    setOffset(0);
    if (currentBBL) {
      fetchViolations(currentBBL, 0, filters);
    }
  }, [filters, currentBBL, fetchViolations]);

  const goToNextPage = useCallback(() => {
    if (data?.nextOffset !== null && currentBBL) {
      fetchViolations(currentBBL, data.nextOffset!, appliedFilters);
    }
  }, [data, currentBBL, appliedFilters, fetchViolations]);

  const goToPrevPage = useCallback(() => {
    if (offset > 0 && currentBBL) {
      const newOffset = Math.max(0, offset - DEFAULT_LIMIT);
      fetchViolations(currentBBL, newOffset, appliedFilters);
    }
  }, [offset, currentBBL, appliedFilters, fetchViolations]);

  const reset = useCallback(() => {
    setFilters({ status: 'all', keyword: '' });
    setAppliedFilters({ status: 'all', keyword: '' });
    setOffset(0);
    setData(null);
    setError(null);
  }, []);

  const retry = useCallback(() => {
    if (currentBBL) {
      fetchViolations(currentBBL, offset, appliedFilters);
    }
  }, [currentBBL, offset, appliedFilters, fetchViolations]);

  return {
    loading: blocked ? false : loading,
    error: blocked ? null : error,
    data: blocked ? null : data,
    items: blocked ? [] : (data?.items || []),
    blocked,
    filters,
    offset: blocked ? 0 : offset,
    fetchViolations,
    setFilters,
    applyFilters,
    goToNextPage,
    goToPrevPage,
    reset,
    retry,
  };
}