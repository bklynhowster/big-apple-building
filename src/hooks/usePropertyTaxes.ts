import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Types from edge function
export type BillingCycle = 'Quarterly' | 'Semiannual' | 'Unknown';
export type PaymentStatus = 'paid' | 'unpaid' | 'unknown';

// Debug info from edge function
export interface DebugInfo {
  request_url: string;
  fields_used: {
    due_date: string[];
    liability: string[];
    balance: string[];
    code: string[];
    tax_year: string[];
    period: string[];
  };
  first_row_keys: string[];
  running_balance_detected: boolean;
  latest_period_key: string | null;
  latest_due_date_raw: string | null;
  periods: Array<{
    due_date: string | null;
    max_liab: number;
    max_bal: number;
    row_count: number;
    codes: string[];
  }>;
  computation_log: string[];
  // Enhanced arrears debug
  arrears_debug: {
    today: string;
    latest_due_date: string | null;
    latest_period_balance: number | null;
    periods_considered: number;
    periods_included_in_arrears: string[];
    max_prior_balance: number | null;
    exclusion_reason?: string;
  };
}

// Result from the period-based property-taxes edge function
export interface PropertyTaxResult {
  // Primary outputs
  latest_bill_amount: number | null;
  latest_due_date: string | null;
  billing_cycle: BillingCycle;
  billing_cycle_evidence: string;
  
  // Payment status
  payment_status: PaymentStatus;
  latest_period_balance: number | null;
  
  // Arrears
  arrears: number | null;
  arrears_available: boolean;
  arrears_note: string;
  
  // Metadata
  bbl_used: string;
  matched_field: string | null;
  matched_key: string | null;
  total_rows_fetched: number;
  period_count: number;
  rows_in_latest_period: number;
  data_source: string;
  no_data_found: boolean;
  cache_status: 'HIT' | 'MISS';
  cached_at: string | null;
  
  // Debug (only when debug=true)
  debug?: DebugInfo;
}

interface UsePropertyTaxesResult {
  loading: boolean;
  error: string | null;
  data: PropertyTaxResult | null;
  fetch: (bbl: string, buildingBbl?: string) => void;
  retry: () => void;
}

// In-memory cache with 30 min TTL (frontend cache)
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

    // Check cache (skip if debug mode)
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
