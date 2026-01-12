import { useState, useCallback } from 'react';

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
}

export interface PermitsFilters {
  status: 'all' | 'open' | 'closed';
  fromDate?: string;
  toDate?: string;
  keyword?: string;
}

export interface UsePermitsReturn {
  loading: boolean;
  error: string | null;
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
}

const DEFAULT_LIMIT = 50;

export function usePermits(bbl?: string | null): UsePermitsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PermitsApiResponse | null>(null);
  const [filters, setFilters] = useState<PermitsFilters>({
    status: 'all',
    keyword: '',
  });
  const [appliedFilters, setAppliedFilters] = useState<PermitsFilters>({
    status: 'all',
    keyword: '',
  });
  const [offset, setOffset] = useState(0);
  const [currentBBL, setCurrentBBL] = useState<string | null>(null);

  const blocked = !bbl || bbl.length !== 10;

  const fetchPermits = useCallback(async (targetBBL: string, targetOffset = 0, targetFilters?: PermitsFilters) => {
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.details || `HTTP ${response.status}`);
      }

      const result: PermitsApiResponse = await response.json();
      setData(result);
      setOffset(targetOffset);
    } catch (err) {
      console.error('Error fetching permits:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch permits');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  const applyFilters = useCallback(() => {
    setAppliedFilters(filters);
    setOffset(0);
    if (currentBBL) {
      fetchPermits(currentBBL, 0, filters);
    }
  }, [filters, currentBBL, fetchPermits]);

  const goToNextPage = useCallback(() => {
    if (data?.nextOffset !== null && currentBBL) {
      fetchPermits(currentBBL, data.nextOffset!, appliedFilters);
    }
  }, [data, currentBBL, appliedFilters, fetchPermits]);

  const goToPrevPage = useCallback(() => {
    if (offset > 0 && currentBBL) {
      const newOffset = Math.max(0, offset - DEFAULT_LIMIT);
      fetchPermits(currentBBL, newOffset, appliedFilters);
    }
  }, [offset, currentBBL, appliedFilters, fetchPermits]);

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
    fetchPermits,
    setFilters,
    applyFilters,
    goToNextPage,
    goToPrevPage,
    reset,
  };
}
