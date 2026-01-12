import { useState, useCallback } from 'react';
import { parseApiError, type ApiError } from '@/types/api-error';

export interface PermitRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  expirationDate: string | null;
  category: string | null;
  description: string | null;
  jobNumber: string | null;
  permitType: string | null;
  workType: string | null;
  applicantName: string | null;
  ownerName: string | null;
  raw: Record<string, unknown>;
}

export interface PermitsApiResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: PermitRecord[];
  nextOffset: number | null;
  requestId?: string;
}

export interface PermitsFilters {
  status: 'all' | 'open' | 'closed';
  fromDate?: string;
  toDate?: string;
  keyword?: string;
}

export interface UsePermitsReturn {
  loading: boolean;
  error: ApiError | null;
  data: PermitsApiResponse | null;
  items: PermitRecord[];
  blocked: boolean;
  filters: PermitsFilters;
  offset: number;
  fetchPermits: (bbl: string) => Promise<void>;
  setFilters: (filters: PermitsFilters) => void;
  applyFilters: () => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  reset: () => void;
  retry: () => void;
}

const DEFAULT_LIMIT = 50;

export function usePermits(bbl?: string | null): UsePermitsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<PermitsApiResponse | null>(null);
  const [filters, setFilters] = useState<PermitsFilters>({ status: 'all', keyword: '' });
  const [appliedFilters, setAppliedFilters] = useState<PermitsFilters>({ status: 'all', keyword: '' });
  const [offset, setOffset] = useState(0);
  const [currentBBL, setCurrentBBL] = useState<string | null>(null);

  const blocked = !bbl || bbl.length !== 10;

  const fetchPermits = useCallback(async (targetBBL: string, targetOffset = 0, targetFilters?: PermitsFilters) => {
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

      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dob-permits`;
      const urlParams = new URLSearchParams(queryParams);
      const fullUrl = `${baseUrl}?${urlParams.toString()}`;

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

      const result: PermitsApiResponse = await response.json();
      setData(result);
      setOffset(targetOffset);
    } catch (err) {
      console.error('Error fetching permits:', err);
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
    if (currentBBL) fetchPermits(currentBBL, 0, filters);
  }, [filters, currentBBL, fetchPermits]);

  const goToNextPage = useCallback(() => {
    if (data?.nextOffset !== null && currentBBL) fetchPermits(currentBBL, data.nextOffset!, appliedFilters);
  }, [data, currentBBL, appliedFilters, fetchPermits]);

  const goToPrevPage = useCallback(() => {
    if (offset > 0 && currentBBL) fetchPermits(currentBBL, Math.max(0, offset - DEFAULT_LIMIT), appliedFilters);
  }, [offset, currentBBL, appliedFilters, fetchPermits]);

  const reset = useCallback(() => {
    setFilters({ status: 'all', keyword: '' });
    setAppliedFilters({ status: 'all', keyword: '' });
    setOffset(0);
    setData(null);
    setError(null);
  }, []);

  const retry = useCallback(() => {
    if (currentBBL) fetchPermits(currentBBL, offset, appliedFilters);
  }, [currentBBL, offset, appliedFilters, fetchPermits]);

  return {
    loading: blocked ? false : loading,
    error: blocked ? null : error,
    data: blocked ? null : data,
    items: blocked ? [] : (data?.items || []),
    blocked,
    filters,
    offset: blocked ? 0 : offset,
    fetchPermits,
    setFilters,
    applyFilters,
    goToNextPage,
    goToPrevPage,
    reset,
    retry,
  };
}