import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Normalized line item from edge function
export interface LineItem {
  date: string | null;
  description: string | null;
  amount: number | null;
  balance: number | null;
  status: string | null;
}

export type OwedStatus = 'paid' | 'due' | 'unknown';

export interface NormalizationDiagnostic {
  field: string;
  candidates_checked: string[];
  matched_field: string | null;
  value: string | number | null;
}

export interface DebugInfo {
  socrata_request_url_used: string;
  raw_rows_count: number;
  raw_first_row: Record<string, unknown> | null;
  raw_first_row_keys: string[];
  raw_sample_keys_union: string[];
  normalization_diagnostics: NormalizationDiagnostic[];
}

export interface PropertyTaxResult {
  current_amount_owed: number | null;
  owed_status: OwedStatus;
  owed_reason: string | null;
  rows_count: number;
  rows_with_numeric_balance: number;
  as_of: string | null;
  line_items: LineItem[];
  scope_used: 'unit' | 'building' | 'direct';
  bbl_used: string;
  matched_field: string | null;
  matched_key: string | null;
  no_data_found: boolean;
  data_source_used: string;
  cache_status: 'HIT' | 'MISS';
  cached_at: string | null;
  debug?: DebugInfo;
}

interface UsePropertyTaxesResult {
  loading: boolean;
  error: string | null;
  data: PropertyTaxResult | null;
  fetch: (bbl: string, buildingBbl?: string) => void;
  retry: () => void;
}

// In-memory cache with 30 min TTL (frontend cache, edge function has 6hr)
const cache = new Map<string, { data: PropertyTaxResult; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export function usePropertyTaxes(): UsePropertyTaxesResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PropertyTaxResult | null>(null);
  
  const lastRequestRef = useRef<{ bbl: string; buildingBbl?: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchTaxes = useCallback(async (bbl: string, buildingBbl?: string) => {
    if (!bbl || bbl.length < 8) {
      setError('Invalid BBL');
      return;
    }

    // Check if debug mode via URL query param
    const isDebugMode = typeof window !== 'undefined' && 
      (new URLSearchParams(window.location.search).get('debugTaxes') === '1');

    // Check cache (skip if debug mode to always get fresh data)
    const cacheKey = `${bbl}:${buildingBbl || ''}`;
    if (!isDebugMode) {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setData(cached.data);
        setLoading(false);
        setError(null);
        return;
      }
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    lastRequestRef.current = { bbl, buildingBbl };
    setLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke('property-taxes', {
        body: { bbl, building_bbl: buildingBbl, debug: isDebugMode },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to fetch tax data');
      }

      if (result?.error) {
        throw new Error(result.error);
      }

      const taxData = result as PropertyTaxResult;
      
      // Update cache
      cache.set(cacheKey, { data: taxData, timestamp: Date.now() });
      
      setData(taxData);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('[usePropertyTaxes] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch tax data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(() => {
    if (lastRequestRef.current) {
      fetchTaxes(lastRequestRef.current.bbl, lastRequestRef.current.buildingBbl);
    }
  }, [fetchTaxes]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return { loading, error, data, fetch: fetchTaxes, retry };
}
