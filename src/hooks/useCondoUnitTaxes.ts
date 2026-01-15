import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PropertyTaxResult } from './usePropertyTaxes';

export interface CondoUnitTaxSummary {
  unitBbl: string;
  unitLabel: string | null;
  loading: boolean;
  error: string | null;
  data: PropertyTaxResult | null;
}

interface UseCondoUnitTaxesResult {
  // Map of unitBbl -> tax data
  unitTaxes: Map<string, CondoUnitTaxSummary>;
  // Fetch taxes for a batch of unit BBLs
  fetchBatch: (units: Array<{ unitBbl: string; unitLabel: string | null }>) => Promise<void>;
  // Fetch a single unit's taxes
  fetchOne: (unitBbl: string, unitLabel: string | null) => Promise<void>;
  // Reset all data
  reset: () => void;
  // Loading state for initial batch
  batchLoading: boolean;
  // Count of units with data loaded
  loadedCount: number;
  // Count of units with errors
  errorCount: number;
  // Count of units with arrears
  arrearsCount: number;
  // Count of units with unpaid status
  unpaidCount: number;
}

// In-memory cache for unit taxes with 30 min TTL
const unitTaxCache = new Map<string, { data: PropertyTaxResult; timestamp: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

// Configurable batch size for lazy loading
const INITIAL_BATCH_SIZE = 10;
const MAX_CONCURRENT_REQUESTS = 5;

export function useCondoUnitTaxes(): UseCondoUnitTaxesResult {
  const [unitTaxes, setUnitTaxes] = useState<Map<string, CondoUnitTaxSummary>>(new Map());
  const [batchLoading, setBatchLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Fetch tax data for a single unit
  const fetchSingleUnit = useCallback(async (
    unitBbl: string,
    unitLabel: string | null,
    signal?: AbortSignal
  ): Promise<PropertyTaxResult | null> => {
    // Check cache first
    const cached = unitTaxCache.get(unitBbl);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke('property-taxes', {
        body: { bbl: unitBbl, debug: false },
      });

      if (signal?.aborted) return null;

      if (fnError) {
        throw new Error(fnError.message || 'Failed to fetch tax data');
      }

      if (result?.error) {
        throw new Error(result.error);
      }

      const taxData = result as PropertyTaxResult;
      
      // Update cache
      unitTaxCache.set(unitBbl, { data: taxData, timestamp: Date.now() });
      
      return taxData;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return null;
      }
      throw err;
    }
  }, []);

  // Fetch taxes for a single unit and update state
  const fetchOne = useCallback(async (unitBbl: string, unitLabel: string | null) => {
    // Set loading state
    setUnitTaxes(prev => {
      const next = new Map(prev);
      next.set(unitBbl, {
        unitBbl,
        unitLabel,
        loading: true,
        error: null,
        data: null,
      });
      return next;
    });

    try {
      const taxData = await fetchSingleUnit(unitBbl, unitLabel);
      
      setUnitTaxes(prev => {
        const next = new Map(prev);
        next.set(unitBbl, {
          unitBbl,
          unitLabel,
          loading: false,
          error: null,
          data: taxData,
        });
        return next;
      });
    } catch (err) {
      setUnitTaxes(prev => {
        const next = new Map(prev);
        next.set(unitBbl, {
          unitBbl,
          unitLabel,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to fetch tax data',
          data: null,
        });
        return next;
      });
    }
  }, [fetchSingleUnit]);

  // Fetch taxes for a batch of units with concurrency control
  const fetchBatch = useCallback(async (
    units: Array<{ unitBbl: string; unitLabel: string | null }>
  ) => {
    if (units.length === 0) return;

    // Cancel previous batch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setBatchLoading(true);

    // Initialize all units as loading
    setUnitTaxes(prev => {
      const next = new Map(prev);
      for (const unit of units) {
        // Only set loading if not already loaded
        if (!next.has(unit.unitBbl) || next.get(unit.unitBbl)?.data === null) {
          next.set(unit.unitBbl, {
            unitBbl: unit.unitBbl,
            unitLabel: unit.unitLabel,
            loading: true,
            error: null,
            data: null,
          });
        }
      }
      return next;
    });

    // Process in batches with concurrency limit
    const processQueue = async () => {
      const queue = [...units];
      const inFlight: Promise<void>[] = [];

      while (queue.length > 0 || inFlight.length > 0) {
        if (signal.aborted) return;

        // Fill up to max concurrent requests
        while (inFlight.length < MAX_CONCURRENT_REQUESTS && queue.length > 0) {
          const unit = queue.shift()!;
          
          const promise = (async () => {
            try {
              // Check if already cached
              const cached = unitTaxCache.get(unit.unitBbl);
              if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                setUnitTaxes(prev => {
                  const next = new Map(prev);
                  next.set(unit.unitBbl, {
                    unitBbl: unit.unitBbl,
                    unitLabel: unit.unitLabel,
                    loading: false,
                    error: null,
                    data: cached.data,
                  });
                  return next;
                });
                return;
              }

              const taxData = await fetchSingleUnit(unit.unitBbl, unit.unitLabel, signal);
              
              if (!signal.aborted && taxData) {
                setUnitTaxes(prev => {
                  const next = new Map(prev);
                  next.set(unit.unitBbl, {
                    unitBbl: unit.unitBbl,
                    unitLabel: unit.unitLabel,
                    loading: false,
                    error: null,
                    data: taxData,
                  });
                  return next;
                });
              }
            } catch (err) {
              if (!signal.aborted) {
                setUnitTaxes(prev => {
                  const next = new Map(prev);
                  next.set(unit.unitBbl, {
                    unitBbl: unit.unitBbl,
                    unitLabel: unit.unitLabel,
                    loading: false,
                    error: err instanceof Error ? err.message : 'Failed to fetch tax data',
                    data: null,
                  });
                  return next;
                });
              }
            }
          })();

          inFlight.push(promise);
        }

        // Wait for at least one to complete
        if (inFlight.length > 0) {
          await Promise.race(inFlight);
          // Remove completed promises
          const results = await Promise.allSettled(inFlight);
          inFlight.length = 0;
          
          // Only add back ones that aren't done
          // (This is simplified - in practice all in inFlight are done after Promise.allSettled)
        }
      }
    };

    try {
      await processQueue();
    } finally {
      if (!signal.aborted) {
        setBatchLoading(false);
      }
    }
  }, [fetchSingleUnit]);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setUnitTaxes(new Map());
    setBatchLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Compute summary stats
  const loadedCount = Array.from(unitTaxes.values()).filter(u => u.data !== null && !u.loading).length;
  const errorCount = Array.from(unitTaxes.values()).filter(u => u.error !== null).length;
  const arrearsCount = Array.from(unitTaxes.values()).filter(u => 
    u.data?.arrears !== null && 
    u.data?.arrears !== undefined && 
    u.data.arrears > 0
  ).length;
  const unpaidCount = Array.from(unitTaxes.values()).filter(u => 
    u.data?.payment_status === 'unpaid'
  ).length;

  return {
    unitTaxes,
    fetchBatch,
    fetchOne,
    reset,
    batchLoading,
    loadedCount,
    errorCount,
    arrearsCount,
    unpaidCount,
  };
}

export { INITIAL_BATCH_SIZE };
