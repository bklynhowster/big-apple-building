import { useState, useEffect, useRef, useCallback } from 'react';
import { logRecordFetch } from '@/utils/recordStatus';

interface SummaryData {
  violations: {
    totalCount: number;
    openCount: number;
    lastActivityDate: string | null;
  };
  ecb: {
    totalCount: number;
    openCount: number;
    lastActivityDate: string | null;
  };
  permits: {
    totalCount: number;
    openCount: number;
    lastActivityDate: string | null;
  };
  safety: {
    totalCount: number;
    openCount: number;
    lastActivityDate: string | null;
  };
  overall: {
    totalOpenCount: number;
    overallLastActivityDate: string | null;
  };
}

interface UseSummaryResult {
  loading: boolean;
  error: string | null;
  data: SummaryData | null;
  blocked: boolean;
}

// Simple in-memory cache
const cache = new Map<string, { data: SummaryData; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchEndpoint(
  baseUrl: string,
  endpoint: string,
  bbl: string,
  apiKey: string,
  signal: AbortSignal
): Promise<{ totalApprox: number; items: Array<{ status: string; issueDate?: string; resolvedDate?: string }> }> {
  const params = new URLSearchParams({ bbl, limit: '200' });
  const response = await fetch(`${baseUrl}/functions/v1/${endpoint}?${params.toString()}`, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiKey,
    },
    signal,
  });

  if (!response.ok) {
    console.warn(`Failed to fetch ${endpoint}: ${response.status}`);
    return { totalApprox: 0, items: [] };
  }

  return response.json();
}

function getLatestDate(items: Array<{ issueDate?: string | null; resolvedDate?: string | null }>): string | null {
  let latest: Date | null = null;

  for (const item of items) {
    const dates = [item.issueDate, item.resolvedDate].filter(Boolean);
    for (const dateStr of dates) {
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime()) && (!latest || date > latest)) {
          latest = date;
        }
      }
    }
  }

  return latest ? latest.toISOString() : null;
}

export function useSummary(bbl?: string | null): UseSummaryResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SummaryData | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const blocked = !bbl || bbl.length !== 10;

  const fetchData = useCallback(async () => {
    if (blocked) {
      // Hard gate: do not fetch
      setError(null);
      setData(null);
      setLoading(false);
      return;
    }

    // Check cache
    const cached = cache.get(bbl);
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
      const baseUrl = import.meta.env.VITE_SUPABASE_URL;
      const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const signal = abortControllerRef.current.signal;

      // Fetch all endpoints in parallel
      const [violationsRes, ecbRes, permitsRes, safetyRes] = await Promise.all([
        fetchEndpoint(baseUrl, 'dob-violations', bbl, apiKey, signal),
        fetchEndpoint(baseUrl, 'dob-ecb', bbl, apiKey, signal),
        fetchEndpoint(baseUrl, 'dob-permits', bbl, apiKey, signal),
        fetchEndpoint(baseUrl, 'dob-safety', bbl, apiKey, signal),
      ]);

      // Calculate counts and dates for each type using canonical helpers
      const violationsOpen = violationsRes.items.filter(i => i.status === 'open').length;
      const ecbOpen = ecbRes.items.filter(i => i.status === 'open').length;
      const permitsOpen = permitsRes.items.filter(i => i.status === 'open').length;
      const safetyOpen = safetyRes.items.filter(i => i.status === 'open').length;
      
      // Debug logging
      logRecordFetch('DOB Violations', `bbl=${bbl}`, { open: violationsOpen, total: violationsRes.items.length });
      logRecordFetch('ECB Violations', `bbl=${bbl}`, { open: ecbOpen, total: ecbRes.items.length });
      logRecordFetch('DOB Permits', `bbl=${bbl}`, { open: permitsOpen, total: permitsRes.items.length });
      logRecordFetch('DOB Safety', `bbl=${bbl}`, { open: safetyOpen, total: safetyRes.items.length });

      const summaryData: SummaryData = {
        violations: {
          totalCount: violationsRes.totalApprox,
          openCount: violationsOpen,
          lastActivityDate: getLatestDate(violationsRes.items),
        },
        ecb: {
          totalCount: ecbRes.totalApprox,
          openCount: ecbOpen,
          lastActivityDate: getLatestDate(ecbRes.items),
        },
        permits: {
          totalCount: permitsRes.totalApprox,
          openCount: permitsOpen,
          lastActivityDate: getLatestDate(permitsRes.items),
        },
        safety: {
          totalCount: safetyRes.totalApprox,
          openCount: safetyOpen,
          lastActivityDate: getLatestDate(safetyRes.items),
        },
        overall: {
          totalOpenCount: violationsOpen + ecbOpen + permitsOpen + safetyOpen,
          overallLastActivityDate: getLatestDate([
            ...violationsRes.items,
            ...ecbRes.items,
            ...permitsRes.items,
            ...safetyRes.items,
          ]),
        },
      };

      // Update cache
      cache.set(bbl, { data: summaryData, timestamp: Date.now() });

      setData(summaryData);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Error fetching summary data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch summary data');
    } finally {
      setLoading(false);
    }
  }, [bbl, blocked]);

  useEffect(() => {
    // Hard gate: do nothing until we have a valid BBL
    if (blocked) {
      setLoading(false);
      return;
    }

    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData, blocked]);

  const derivedLoading = blocked ? false : loading;
  const derivedError = blocked ? null : error;
  const derivedData = blocked ? null : data;

  return { loading: derivedLoading, error: derivedError, data: derivedData, blocked };
}

// Export cache clear function
export function clearSummaryCache() {
  cache.clear();
}
