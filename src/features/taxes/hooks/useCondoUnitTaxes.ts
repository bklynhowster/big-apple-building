/**
 * Hook for batch/lazy fetching condo unit taxes with concurrency control
 * 
 * CRITICAL: All BBL keys are normalized to 10-digit format using normalizeBbl()
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
import { normalizeBbl } from '../utils/format';

interface UseCondoUnitTaxesResult {
  /** Map of normalized unitBbl -> tax data */
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

// In-memory cache for unit taxes (keyed by normalized BBL)
const unitTaxCache = new Map<string, { data: PropertyTaxResult; timestamp: number }>();

// Debug mode check
const DEBUG_MODE = typeof window !== 'undefined' && 
  new URLSearchParams(window.location.search).has('debug');

export function useCondoUnitTaxes(): UseCondoUnitTaxesResult {
  const [unitTaxes, setUnitTaxes] = useState<Map<string, CondoUnitTaxSummary>>(() => new Map());
  const [batchLoading, setBatchLoading] = useState(false);
  
  // Track in-flight requests by normalized BBL
  const abortControllerRef = useRef<AbortController | null>(null);
  const inFlightBblsRef = useRef<Set<string>>(new Set());

  // Fetch tax data for a single unit - returns promise
  const fetchSingleUnit = useCallback(async (
    normalizedBbl: string,
    signal?: AbortSignal
  ): Promise<PropertyTaxResult | null> => {
    // Check cache first
    const cached = unitTaxCache.get(normalizedBbl);
    if (cached && Date.now() - cached.timestamp < TAX_CACHE_TTL_MS) {
      if (DEBUG_MODE) console.log(`[useCondoUnitTaxes] Cache HIT for ${normalizedBbl}`);
      return cached.data;
    }

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke('property-taxes', {
        body: { bbl: normalizedBbl, debug: false },
      });

      if (signal?.aborted) return null;

      if (fnError) {
        throw new Error(fnError.message || 'Failed to fetch tax data');
      }

      if (result?.error) {
        throw new Error(result.error);
      }

      const taxData = result as PropertyTaxResult;
      
      // Update cache with normalized key
      unitTaxCache.set(normalizedBbl, { data: taxData, timestamp: Date.now() });
      
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
    const normalizedBbl = normalizeBbl(unitBbl);
    if (!normalizedBbl) return;
    
    // Skip if already in-flight
    if (inFlightBblsRef.current.has(normalizedBbl)) {
      if (DEBUG_MODE) console.log(`[useCondoUnitTaxes] Skipping ${normalizedBbl} - already in flight`);
      return;
    }
    
    inFlightBblsRef.current.add(normalizedBbl);
    
    // Set loading state
    setUnitTaxes(prev => {
      const next = new Map(prev);
      next.set(normalizedBbl, {
        unitBbl: normalizedBbl,
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
        const taxData = await fetchSingleUnit(normalizedBbl, abortControllerRef.current?.signal);
        
        if (taxData) {
          setUnitTaxes(prev => {
            const next = new Map(prev);
            next.set(normalizedBbl, {
              unitBbl: normalizedBbl,
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
          next.set(normalizedBbl, {
            unitBbl: normalizedBbl,
            unitLabel,
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to fetch tax data',
            data: null,
          });
          return next;
        });
      } finally {
        inFlightBblsRef.current.delete(normalizedBbl);
      }
    })();
  }, [fetchSingleUnit]);

  // Fetch taxes for a batch of units with concurrency control
  const fetchBatch = useCallback((
    units: Array<{ unitBbl: string; unitLabel: string | null }>
  ) => {
    if (units.length === 0) return;

    // Normalize all BBLs upfront and filter empty
    const normalizedUnits = units
      .map(u => ({
        unitBbl: normalizeBbl(u.unitBbl),
        unitLabel: u.unitLabel,
      }))
      .filter(u => u.unitBbl.length === 10);

    if (normalizedUnits.length === 0) return;

    // Cancel previous batch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setBatchLoading(true);

    if (DEBUG_MODE) {
      console.log(`[useCondoUnitTaxes] Starting batch fetch for ${normalizedUnits.length} units`, 
        normalizedUnits.slice(0, 3).map(u => u.unitBbl));
    }

    // Filter out in-flight units
    const unitsToFetch = normalizedUnits.filter(u => !inFlightBblsRef.current.has(u.unitBbl));

    if (unitsToFetch.length === 0) {
      setBatchLoading(false);
      return;
    }

    // Mark all as in-flight
    for (const unit of unitsToFetch) {
      inFlightBblsRef.current.add(unit.unitBbl);
    }

    // Initialize loading state for all units to fetch
    setUnitTaxes(prev => {
      const next = new Map(prev);
      for (const unit of unitsToFetch) {
        // Only set loading if not already has data
        const existing = next.get(unit.unitBbl);
        if (!existing || (!existing.data && !existing.loading && !existing.error)) {
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
            // Check cache first
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
  // Uses refs to avoid stale closure issues
  const ensureLoaded = useCallback((
    units: Array<{ unitBbl: string; unitLabel: string | null }>
  ) => {
    if (units.length === 0) return;

    // Use functional update to access latest state without stale closures
    setUnitTaxes(currentTaxes => {
      // Normalize all BBLs and filter out already loaded or in-flight
      const missingUnits = units
        .map(u => ({
          unitBbl: normalizeBbl(u.unitBbl),
          unitLabel: u.unitLabel,
        }))
        .filter(u => {
          if (u.unitBbl.length !== 10) return false;
          const existing = currentTaxes.get(u.unitBbl);
          // Skip if already has data or error (complete)
          if (existing && (existing.data || existing.error)) return false;
          // Skip if loading
          if (existing?.loading) return false;
          // Skip if in-flight
          if (inFlightBblsRef.current.has(u.unitBbl)) return false;
          return true;
        });

      if (missingUnits.length === 0) {
        if (DEBUG_MODE) console.log('[useCondoUnitTaxes] ensureLoaded: all units already loaded/in-flight');
        return currentTaxes; // No state change
      }

      if (DEBUG_MODE) {
        console.log(`[useCondoUnitTaxes] ensureLoaded: queueing ${missingUnits.length} missing units`, 
          missingUnits.slice(0, 3).map(u => u.unitBbl));
      }

      // Schedule fetch outside of state update
      setTimeout(() => {
        fetchBatch(missingUnits);
      }, 0);

      return currentTaxes; // No state change here - fetchBatch will update
    });
  }, [fetchBatch]);

  // Check if a specific BBL is currently loading
  const isLoading = useCallback((unitBbl: string): boolean => {
    const normalized = normalizeBbl(unitBbl);
    return inFlightBblsRef.current.has(normalized);
  }, []);

  // Check if a BBL has been requested (either in-flight or in unitTaxes)
  const isRequested = useCallback((unitBbl: string): boolean => {
    const normalized = normalizeBbl(unitBbl);
    return inFlightBblsRef.current.has(normalized) || unitTaxes.has(normalized);
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
