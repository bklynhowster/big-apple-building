import { useState, useCallback, useRef } from 'react';
import { parseApiError, type ApiError } from '@/types/api-error';

export interface HPDViolationRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  violationClass: string | null;
  raw: Record<string, unknown>;
}

export interface HPDComplaintRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  raw: Record<string, unknown>;
}

export interface HPDApiResponse<T> {
  source: string;
  bbl: string;
  totalApprox: number;
  items: T[];
  nextOffset: number | null;
  requestId?: string;
}

export interface HPDFilters {
  status: 'all' | 'open' | 'closed';
  fromDate?: string;
  toDate?: string;
  keyword?: string;
  violationClass?: string; // A, B, C, I for violations only
}

interface UseHPDResult<T> {
  loading: boolean;
  error: ApiError | null;
  data: HPDApiResponse<T> | null;
  items: T[];
  blocked: boolean;
  filters: HPDFilters;
  offset: number;
  fetch: (bbl: string) => Promise<void>;
  setFilters: (filters: HPDFilters) => void;
  applyFilters: () => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  reset: () => void;
  retry: () => void;
}

const DEFAULT_LIMIT = 50;

function createHPDHook<T>(endpoint: 'hpd-violations' | 'hpd-complaints') {
  return function useHPDData(bbl?: string | null): UseHPDResult<T> {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<ApiError | null>(null);
    const [data, setData] = useState<HPDApiResponse<T> | null>(null);
    const [filters, setFilters] = useState<HPDFilters>({
      status: 'all',
      keyword: '',
    });
    const [appliedFilters, setAppliedFilters] = useState<HPDFilters>({
      status: 'all',
      keyword: '',
    });
    const [offset, setOffset] = useState(0);
    const [currentBBL, setCurrentBBL] = useState<string | null>(null);
    const loggedUrlsRef = useRef<Set<string>>(new Set());

    const blocked = !bbl || bbl.length !== 10;

    const fetchData = useCallback(async (targetBBL: string, targetOffset = 0, targetFilters?: HPDFilters) => {
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
        if (filtersToUse.violationClass && endpoint === 'hpd-violations') {
          queryParams.class = filtersToUse.violationClass;
        }

        const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`;
        const urlParams = new URLSearchParams(queryParams);
        const fullUrl = `${baseUrl}?${urlParams.toString()}`;

        if (!loggedUrlsRef.current.has(fullUrl)) {
          console.log(`[use${endpoint}] fetching:`, fullUrl);
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

        const result: HPDApiResponse<T> = await response.json();
        setData(result);
        setOffset(targetOffset);
      } catch (err) {
        console.error(`Error fetching ${endpoint}:`, err);
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
        fetchData(currentBBL, 0, filters);
      }
    }, [filters, currentBBL, fetchData]);

    const goToNextPage = useCallback(() => {
      if (data?.nextOffset !== null && currentBBL) {
        fetchData(currentBBL, data.nextOffset!, appliedFilters);
      }
    }, [data, currentBBL, appliedFilters, fetchData]);

    const goToPrevPage = useCallback(() => {
      if (offset > 0 && currentBBL) {
        const newOffset = Math.max(0, offset - DEFAULT_LIMIT);
        fetchData(currentBBL, newOffset, appliedFilters);
      }
    }, [offset, currentBBL, appliedFilters, fetchData]);

    const reset = useCallback(() => {
      setFilters({ status: 'all', keyword: '' });
      setAppliedFilters({ status: 'all', keyword: '' });
      setOffset(0);
      setData(null);
      setError(null);
    }, []);

    const retry = useCallback(() => {
      if (currentBBL) {
        fetchData(currentBBL, offset, appliedFilters);
      }
    }, [currentBBL, offset, appliedFilters, fetchData]);

    return {
      loading: blocked ? false : loading,
      error: blocked ? null : error,
      data: blocked ? null : data,
      items: blocked ? [] : (data?.items || []),
      blocked,
      filters,
      offset: blocked ? 0 : offset,
      fetch: fetchData,
      setFilters,
      applyFilters,
      goToNextPage,
      goToPrevPage,
      reset,
      retry,
    };
  };
}

export const useHPDViolations = createHPDHook<HPDViolationRecord>('hpd-violations');
export const useHPDComplaints = createHPDHook<HPDComplaintRecord>('hpd-complaints');
