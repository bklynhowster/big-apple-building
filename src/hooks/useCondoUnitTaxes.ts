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
  fetchBatch: (units: Array<{ unitBbl: string; unitLabel: string | null }>) => void;
  // Fetch a single unit's taxes
  fetchOne: (unitBbl: string, unitLabel: string | null) => void;
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
export const INITIAL_BATCH_SIZE = 10;
const MAX_CONCURRENT_REQUESTS = 3; // Reduced for better performance
const YIELD_INTERVAL_MS = 50; // Yield to main thread between batches

// Debug mode
const DEBUG_MODE = typeof window !== 'undefined' && 
  new URLSearchParams(window.location.search).has('debug');

export function useCondoUnitTaxes(): UseCondoUnitTaxesResult {
  // Use a stable Map via useState to avoid ref accumulation issues
  const [unitTaxes, setUnitTaxes] = useState<Map<string, CondoUnitTaxSummary>>(() => new Map());
  const [batchLoading, setBatchLoading] = useState(false);
  
  // Track in-flight requests to cancel on unmount/reset
  const abortControllerRef = useRef<AbortController | null>(null);
  // Track BBLs currently being fetched to prevent double-fetching
  const inFlightBblsRef = useRef<Set<string>>(new Set());
  // Track the building context to detect navigation changes
  const buildingContextRef = useRef<string | null>(null);

  // Fetch tax data for a single unit - returns promise
  const fetchSingleUnit = useCallback(async (
    unitBbl: string,
    signal?: AbortSignal
  ): Promise<PropertyTaxResult | null> => {
    // Check cache first
    const cached = unitTaxCache.get(unitBbl);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
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
    // Skip if already fetched or in-flight
    if (inFlightBblsRef.current.has(unitBbl)) {
      if (DEBUG_MODE) console.log(`[useCondoUnitTaxes] Skipping ${unitBbl} - already in flight`);
      return;
    }
    
    // Mark as in-flight
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
  // FIXED: Pure function that computes from current state, no ref accumulation
  const fetchBatch = useCallback((
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

    if (DEBUG_MODE) {
      console.log(`[useCondoUnitTaxes] Starting batch fetch for ${units.length} units`);
    }

    // Filter out already loaded or in-flight units
    const unitsToFetch = units.filter(u => {
      // Skip if already in-flight
      if (inFlightBblsRef.current.has(u.unitBbl)) {
        return false;
      }
      return true;
    });

    if (unitsToFetch.length === 0) {
      setBatchLoading(false);
      return;
    }

    // Mark all as in-flight
    for (const unit of unitsToFetch) {
      inFlightBblsRef.current.add(unit.unitBbl);
    }

    // Initialize loading state for units not yet in the map
    setUnitTaxes(prev => {
      const next = new Map(prev);
      for (const unit of unitsToFetch) {
        // Only set loading if not already loaded with data
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

    // Process in batches with concurrency limit
    const processQueue = async () => {
      const queue = [...unitsToFetch];
      
      while (queue.length > 0 && !signal.aborted) {
        // Take a batch
        const batch = queue.splice(0, MAX_CONCURRENT_REQUESTS);
        
        // Process batch concurrently
        const promises = batch.map(async (unit) => {
          try {
            // Check cache first
            const cached = unitTaxCache.get(unit.unitBbl);
            if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
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

        // Wait for batch to complete
        await Promise.allSettled(promises);
        
        // Yield to main thread between batches to prevent UI freeze
        if (queue.length > 0 && !signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, YIELD_INTERVAL_MS));
        }
      }
    };

    // Run async process
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      inFlightBblsRef.current.clear();
    };
  }, []);

  // Compute summary stats - derived from current state only, no refs
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
