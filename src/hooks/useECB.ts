import { useState, useCallback } from 'react';
import { parseApiError, type ApiError } from '@/types/api-error';

export interface ECBRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'resolved' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  penaltyAmount: number | null;
  amountPaid: number | null;
  balanceDue: number | null;
  severity: string | null;
  raw: Record<string, unknown>;
}

export interface ECBApiResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: ECBRecord[];
  nextOffset: number | null;
  requestId?: string;
}

export interface ECBFilters {
  status: 'all' | 'open' | 'resolved';
  fromDate?: string;
  toDate?: string;
  keyword?: string;
}

export interface UseECBReturn {
  loading: boolean;
  error: ApiError | null;
  data: ECBApiResponse | null;
  items: ECBRecord[];
  blocked: boolean;
  filters: ECBFilters;
  offset: number;
  fetchECB: (bbl: string) => Promise<void>;
  setFilters: (filters: ECBFilters) => void;
  applyFilters: () => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  reset: () => void;
  retry: () => void;
}

const DEFAULT_LIMIT = 50;

export function useECB(bbl?: string | null): UseECBReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<ECBApiResponse | null>(null);
  const [filters, setFilters] = useState<ECBFilters>({ status: 'all', keyword: '' });
  const [appliedFilters, setAppliedFilters] = useState<ECBFilters>({ status: 'all', keyword: '' });
  const [offset, setOffset] = useState(0);
  const [currentBBL, setCurrentBBL] = useState<string | null>(null);

  const blocked = !bbl || bbl.length !== 10;

  const fetchECB = useCallback(async (targetBBL: string, targetOffset = 0, targetFilters?: ECBFilters) => {
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

      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dob-ecb`;
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

      const result: ECBApiResponse = await response.json();
      setData(result);
      setOffset(targetOffset);
    } catch (err) {
      console.error('Error fetching ECB violations:', err);
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
    if (currentBBL) fetchECB(currentBBL, 0, filters);
  }, [filters, currentBBL, fetchECB]);

  const goToNextPage = useCallback(() => {
    if (data?.nextOffset !== null && currentBBL) fetchECB(currentBBL, data.nextOffset!, appliedFilters);
  }, [data, currentBBL, appliedFilters, fetchECB]);

  const goToPrevPage = useCallback(() => {
    if (offset > 0 && currentBBL) fetchECB(currentBBL, Math.max(0, offset - DEFAULT_LIMIT), appliedFilters);
  }, [offset, currentBBL, appliedFilters, fetchECB]);

  const reset = useCallback(() => {
    setFilters({ status: 'all', keyword: '' });
    setAppliedFilters({ status: 'all', keyword: '' });
    setOffset(0);
    setData(null);
    setError(null);
  }, []);

  const retry = useCallback(() => {
    if (currentBBL) fetchECB(currentBBL, offset, appliedFilters);
  }, [currentBBL, offset, appliedFilters, fetchECB]);

  return {
    loading: blocked ? false : loading,
    error: blocked ? null : error,
    data: blocked ? null : data,
    items: blocked ? [] : (data?.items || []),
    blocked,
    filters,
    offset: blocked ? 0 : offset,
    fetchECB,
    setFilters,
    applyFilters,
    goToNextPage,
    goToPrevPage,
    reset,
    retry,
  };
}