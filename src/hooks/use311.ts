import { useState, useCallback, useRef } from 'react';
import { parseApiError, type ApiError } from '@/types/api-error';

export interface ServiceRequestRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  agency: string | null;
  raw: Record<string, unknown>;
}

export interface ServiceRequestsApiResponse {
  source: string;
  lat: number;
  lon: number;
  radiusMeters: number;
  totalApprox: number;
  items: ServiceRequestRecord[];
  nextOffset: number | null;
  requestId?: string;
}

export interface ServiceRequestFilters {
  status: 'all' | 'open' | 'closed';
  fromDate?: string;
  toDate?: string;
  keyword?: string;
  radiusMeters?: number;
}

export interface Use311Return {
  loading: boolean;
  error: ApiError | null;
  data: ServiceRequestsApiResponse | null;
  items: ServiceRequestRecord[];
  blocked: boolean;
  filters: ServiceRequestFilters;
  offset: number;
  fetch: (lat: number, lon: number) => Promise<void>;
  setFilters: (filters: ServiceRequestFilters) => void;
  applyFilters: () => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  reset: () => void;
  retry: () => void;
}

const DEFAULT_LIMIT = 100;
const DEFAULT_RADIUS = 250;

export function use311(lat?: number, lon?: number): Use311Return {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<ServiceRequestsApiResponse | null>(null);
  
  // Default to 90 days back
  const defaultFromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const [filters, setFilters] = useState<ServiceRequestFilters>({
    status: 'all',
    keyword: '',
    radiusMeters: DEFAULT_RADIUS,
    fromDate: defaultFromDate,
  });
  const [appliedFilters, setAppliedFilters] = useState<ServiceRequestFilters>({
    status: 'all',
    keyword: '',
    radiusMeters: DEFAULT_RADIUS,
    fromDate: defaultFromDate,
  });
  const [offset, setOffset] = useState(0);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lon: number } | null>(null);
  const loggedUrlsRef = useRef<Set<string>>(new Set());

  const blocked = lat === undefined || lon === undefined || isNaN(lat) || isNaN(lon);

  const fetchData = useCallback(async (targetLat: number, targetLon: number, targetOffset = 0, targetFilters?: ServiceRequestFilters) => {
    if (isNaN(targetLat) || isNaN(targetLon)) return;

    setLoading(true);
    setError(null);
    setCurrentCoords({ lat: targetLat, lon: targetLon });

    const filtersToUse = targetFilters || appliedFilters;

    try {
      const queryParams: Record<string, string> = {
        lat: String(targetLat),
        lon: String(targetLon),
        limit: String(DEFAULT_LIMIT),
        offset: String(targetOffset),
        radiusMeters: String(filtersToUse.radiusMeters || DEFAULT_RADIUS),
      };

      if (filtersToUse.status !== 'all') queryParams.status = filtersToUse.status;
      if (filtersToUse.fromDate) queryParams.fromDate = filtersToUse.fromDate;
      if (filtersToUse.toDate) queryParams.toDate = filtersToUse.toDate;
      if (filtersToUse.keyword) queryParams.q = filtersToUse.keyword;

      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/service-requests-311`;
      const urlParams = new URLSearchParams(queryParams);
      const fullUrl = `${baseUrl}?${urlParams.toString()}`;

      if (!loggedUrlsRef.current.has(fullUrl)) {
        console.log('[use311] fetching:', fullUrl);
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

      const result: ServiceRequestsApiResponse = await response.json();
      setData(result);
      setOffset(targetOffset);
    } catch (err) {
      console.error('Error fetching 311 requests:', err);
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
    if (currentCoords) {
      fetchData(currentCoords.lat, currentCoords.lon, 0, filters);
    }
  }, [filters, currentCoords, fetchData]);

  const goToNextPage = useCallback(() => {
    if (data?.nextOffset !== null && currentCoords) {
      fetchData(currentCoords.lat, currentCoords.lon, data.nextOffset!, appliedFilters);
    }
  }, [data, currentCoords, appliedFilters, fetchData]);

  const goToPrevPage = useCallback(() => {
    if (offset > 0 && currentCoords) {
      const newOffset = Math.max(0, offset - DEFAULT_LIMIT);
      fetchData(currentCoords.lat, currentCoords.lon, newOffset, appliedFilters);
    }
  }, [offset, currentCoords, appliedFilters, fetchData]);

  const reset = useCallback(() => {
    setFilters({ 
      status: 'all', 
      keyword: '', 
      radiusMeters: DEFAULT_RADIUS,
      fromDate: defaultFromDate,
    });
    setAppliedFilters({ 
      status: 'all', 
      keyword: '', 
      radiusMeters: DEFAULT_RADIUS,
      fromDate: defaultFromDate,
    });
    setOffset(0);
    setData(null);
    setError(null);
  }, [defaultFromDate]);

  const retry = useCallback(() => {
    if (currentCoords) {
      fetchData(currentCoords.lat, currentCoords.lon, offset, appliedFilters);
    }
  }, [currentCoords, offset, appliedFilters, fetchData]);

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
}
