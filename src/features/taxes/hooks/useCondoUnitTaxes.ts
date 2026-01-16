/**
 * Hook for batch/lazy fetching condo unit taxes with concurrency control
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PropertyTaxResult, CondoUnitTaxSummary } from '../types';
import { 
  INITIAL_TAX_BATCH_SIZE,
  MAX_CONCURRENT_TAX_REQUESTS,
  YIELD_INTERVAL_MS,
  TAX_CACHE_TTL_MS,
} from '../types';

interface UseCondoUnitTaxesResult {
  /** Map of unitBbl -> tax data */
  unitTaxes: Map<string, CondoUnitTaxSummary>;
  /** Ensure taxes are loaded for a set of BBLs (dedupes and fetches only missing) */
  ensureLoaded: (units: Array<{ unitBbl: string; unitLabel: string | null }>) => void;
  /** Fetch taxes for a batch of unit BBLs (replaces fetchBatch for backwards compat) */
  fetchBatch: (units: Array<{ unitBbl: string; unitLabel: string | null }>) => void;
  /** Fetch a single unit's taxes */
  fetchOne: (unitBbl: string, unitLabel: string | null) => void;
  /** Reset all data */
  reset: () => void;
  /** Loading state for batch operations */
  batchLoading: boolean;
  /** Count of units with data loaded */
  loadedCount: number;
  /** Count of units with errors */
  errorCount: number;
  /** Count of units with arrears */
  arrearsCount: number;
  /** Count of units with unpaid status */
  unpaidCount: number;
  /** Check if a BBL is in-flight (loading) */
  isLoading: (unitBbl: string) => boolean;
  /** Check if a BBL has been requested (in-flight or loaded) */
  isRequested: (unitBbl: string) => boolean;
}

// In-memory cache for unit taxes
const unitTaxCache = new Map<string, { data: PropertyTaxResult; timestamp: number }>();

// Debug mode check
const DEBUG_MODE = typeof window !== 'undefined' && 
  new URLSearchParams(window.location.search).has('debug');

export function useCondoUnitTaxes(): UseCondoUnitTaxesResult {
  const [unitTaxes, setUnitTaxes] = useState<Map<string, CondoUnitTaxSummary>>(() => new Map());
  const [batchLoading, setBatchLoading] = useState(false);
  
  // Track in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);
  const inFlightBblsRef = useRef<Set<string>>(new Set());

  // Fetch tax data for a single unit - returns promise
  const fetchSingleUnit = useCallback(async (
    unitBbl: string,
    signal?: AbortSignal
  ): Promise<PropertyTaxResult | null> => {
    // Check cache first
    const cached = unitTaxCache.get(unitBbl);
    if (cached && Date.now() - cached.timestamp < TAX_CACHE_TTL_MS) {
      if (DEBUG_MODE) console.log(`[useCondoUnitTaxes] Cache HIT for ${unitBbl}`);
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
  const fetchOne = useCallback((unitBbl: string, unitLabel: string | null) => {
    // Skip if already in-flight
    if (inFlightBblsRef.current.has(unitBbl)) {
      if (DEBUG_MODE) console.log(`[useCondoUnitTaxes] Skipping ${unitBbl} - already in flight`);
      return;
    }
    
    inFlightBblsRef.current.add(unitBbl);
    
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

    // Start async fetch
    (async () => {
      try {
        const taxData = await fetchSingleUnit(unitBbl, abortControllerRef.current?.signal);
        
        if (taxData) {
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
        }
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
      } finally {
        inFlightBblsRef.current.delete(unitBbl);
      }
    })();
  }, [fetchSingleUnit]);

  // Fetch taxes for a batch of units with concurrency control
  const fetchBatch = useCallback((
    units: Array<{ unitBbl: string; unitLabel: string | null }>
  ) => {
    if (units.length === 0) return;

    // Cancel previous batch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setBatchLoading(true);

    if (DEBUG_MODE) {
      console.log(`[useCondoUnitTaxes] Starting batch fetch for ${units.length} units`);
    }

    // Filter out in-flight units
    const unitsToFetch = units.filter(u => !inFlightBblsRef.current.has(u.unitBbl));

    if (unitsToFetch.length === 0) {
      setBatchLoading(false);
      return;
    }

    // Mark all as in-flight
    for (const unit of unitsToFetch) {
      inFlightBblsRef.current.add(unit.unitBbl);
    }

    // Initialize loading state
    setUnitTaxes(prev => {
      const next = new Map(prev);
      for (const unit of unitsToFetch) {
        const existing = next.get(unit.unitBbl);
        if (!existing || (!existing.data && !existing.loading)) {
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

    // Process with concurrency limit
    const processQueue = async () => {
      const queue = [...unitsToFetch];
      
      while (queue.length > 0 && !signal.aborted) {
        const batch = queue.splice(0, MAX_CONCURRENT_TAX_REQUESTS);
        
        const promises = batch.map(async (unit) => {
          try {
            // Check cache
            const cached = unitTaxCache.get(unit.unitBbl);
            if (cached && Date.now() - cached.timestamp < TAX_CACHE_TTL_MS) {
              if (!signal.aborted) {
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
              }
              return;
            }

            const taxData = await fetchSingleUnit(unit.unitBbl, signal);
            
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
          } finally {
            inFlightBblsRef.current.delete(unit.unitBbl);
          }
        });

        await Promise.allSettled(promises);
        
        // Yield to main thread
        if (queue.length > 0 && !signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, YIELD_INTERVAL_MS));
        }
      }
    };

    processQueue().finally(() => {
      if (!signal.aborted) {
        setBatchLoading(false);
      }
    });
  }, [fetchSingleUnit]);

  const reset = useCallback(() => {
    if (DEBUG_MODE) console.log('[useCondoUnitTaxes] Resetting state');
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    inFlightBblsRef.current.clear();
    setUnitTaxes(new Map());
    setBatchLoading(false);
  }, []);

  // ensureLoaded: dedupes BBLs already fetched or in-flight, fetches only missing
  const ensureLoaded = useCallback((
    units: Array<{ unitBbl: string; unitLabel: string | null }>
  ) => {
    if (units.length === 0) return;

    // Filter out units that are already loaded or in-flight
    const missingUnits = units.filter(u => {
      const existing = unitTaxes.get(u.unitBbl);
      // Skip if already has data (loaded or error)
      if (existing && !existing.loading) return false;
      // Skip if in-flight
      if (inFlightBblsRef.current.has(u.unitBbl)) return false;
      return true;
    });

    if (missingUnits.length === 0) {
      if (DEBUG_MODE) console.log('[useCondoUnitTaxes] ensureLoaded: all units already loaded/in-flight');
      return;
    }

    if (DEBUG_MODE) {
      console.log(`[useCondoUnitTaxes] ensureLoaded: fetching ${missingUnits.length} missing units`);
    }

    // Use fetchBatch for the missing units
    fetchBatch(missingUnits);
  }, [unitTaxes, fetchBatch]);

  // Check if a specific BBL is currently loading
  const isLoading = useCallback((unitBbl: string): boolean => {
    return inFlightBblsRef.current.has(unitBbl);
  }, []);

  // Check if a BBL has been requested (either in-flight or in unitTaxes)
  const isRequested = useCallback((unitBbl: string): boolean => {
    return inFlightBblsRef.current.has(unitBbl) || unitTaxes.has(unitBbl);
  }, [unitTaxes]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      inFlightBblsRef.current.clear();
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
    ensureLoaded,
    fetchBatch,
    fetchOne,
    reset,
    batchLoading,
    loadedCount,
    errorCount,
    arrearsCount,
    unpaidCount,
    isLoading,
    isRequested,
  };
}

// Re-export batch size for consumers
export { INITIAL_TAX_BATCH_SIZE };
