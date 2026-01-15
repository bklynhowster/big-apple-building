import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Basis and confidence types from edge function
export type TaxBasis = 'dof_assessment' | 'pluto_estimate' | 'unavailable';
export type TaxConfidence = 'high' | 'estimated' | 'none';
export type ArrearsStatus = 'none_detected' | 'unavailable';

// Debug info from edge function
export interface DebugInfo {
  step1_attempted: boolean;
  step1_url: string | null;
  step1_success: boolean;
  step1_error: string | null;
  step2_attempted: boolean;
  step2_url: string | null;
  step2_success: boolean;
  step2_error: string | null;
  raw_dof_row: Record<string, unknown> | null;
  raw_pluto_row: Record<string, unknown> | null;
  dof_row_keys: string[];
  pluto_row_keys: string[];
  calculation_steps: string[];
}

// Result from the 3-step property-taxes edge function
export interface PropertyTaxResult {
  // Primary outputs
  quarterly_bill: number | null;
  annual_tax: number | null;
  billing_cycle: string;
  due_date: string;
  due_date_formatted: string;
  
  // Data source tracking
  basis: TaxBasis;
  confidence: TaxConfidence;
  basis_explanation: string;
  
  // Assessment data
  tax_class: string | null;
  tax_rate: number | null;
  tax_rate_description: string;
  assessed_value: number | null;
  exempt_value: number | null;
  taxable_billable_av: number | null;
  
  // Arrears
  arrears: number | null;
  arrears_status: ArrearsStatus;
  arrears_note: string;
  
  // Metadata
  bbl_used: string;
  address: string | null;
  owner_name: string | null;
  building_class: string | null;
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
