import { useState, useCallback, useRef } from 'react';

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
}

export interface ViolationsFilters {
  status: 'all' | 'open' | 'resolved';
  fromDate?: string;
  toDate?: string;
  keyword?: string;
}

export interface UseViolationsReturn {
  loading: boolean;
  error: string | null;
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
}

const DEFAULT_LIMIT = 50;

export function useViolations(bbl?: string | null): UseViolationsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    // Hard gate: never fetch unless we have a valid 10-digit BBL
    if (!targetBBL || targetBBL.length !== 10) return;

    setLoading(true);
    setError(null);
    setCurrentBBL(targetBBL);

    const filtersToUse = targetFilters || appliedFilters;

    try {
      // Build query params
      const queryParams: Record<string, string> = {
        bbl: targetBBL,
        limit: String(DEFAULT_LIMIT),
        offset: String(targetOffset),
      };

      if (filtersToUse.status !== 'all') {
        queryParams.status = filtersToUse.status;
      }
      if (filtersToUse.fromDate) {
        queryParams.fromDate = filtersToUse.fromDate;
      }
      if (filtersToUse.toDate) {
        queryParams.toDate = filtersToUse.toDate;
      }
      if (filtersToUse.keyword) {
        queryParams.q = filtersToUse.keyword;
      }

      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dob-violations`;
      const urlParams = new URLSearchParams(queryParams);
      const fullUrl = `${baseUrl}?${urlParams.toString()}`;

      // Temporary diagnostics: log the actual request URL once per unique URL
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.details || `HTTP ${response.status}`);
      }

      const result: ViolationsApiResponse = await response.json();
      setData(result);
      setOffset(targetOffset);
    } catch (err) {
      console.error('Error fetching violations:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch violations');
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

  const derivedLoading = blocked ? false : loading;
  const derivedError = blocked ? null : error;
  const derivedData = blocked ? null : data;
  const derivedItems = blocked ? [] : (data?.items || []);

  return {
    loading: derivedLoading,
    error: derivedError,
    data: derivedData,
    items: derivedItems,
    blocked,
    filters,
    offset: blocked ? 0 : offset,
    fetchViolations,
    setFilters,
    applyFilters,
    goToNextPage,
    goToPrevPage,
    reset,
  };
}
