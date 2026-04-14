import { useState, useEffect, useRef, useCallback } from 'react';
import { logRecordFetch } from '@/utils/recordStatus';
import { fetchDobViolationsDirect } from '@/utils/dobViolationsDirect';

interface ScopeSummary {
  violations: { totalCount: number; openCount: number; lastActivityDate: string | null };
  ecb: { totalCount: number; openCount: number; lastActivityDate: string | null };
  permits: { totalCount: number; openCount: number; lastActivityDate: string | null };
  safety: { totalCount: number; openCount: number; lastActivityDate: string | null };
  hpd: { totalCount: number; openCount: number; lastActivityDate: string | null };
  overall: { totalOpenCount: number; overallLastActivityDate: string | null };
}

export interface DualScopeSummaryData {
  unit: ScopeSummary | null;
  building: ScopeSummary | null;
  isUnitCapable: {
    violations: boolean;
    ecb: boolean;
    permits: boolean;
    safety: boolean;
    hpd: boolean;
  };
}

interface UseDualScopeSummaryResult {
  loading: boolean;
  error: string | null;
  data: DualScopeSummaryData | null;
  unitBbl: string | null;
  billingBbl: string | null;
}

// Separate caches for unit and building scopes
const unitCache = new Map<string, { data: ScopeSummary; timestamp: number }>();
const buildingCache = new Map<string, { data: ScopeSummary; timestamp: number }>();
const UNIT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for unit
const BUILDING_CACHE_TTL = 10 * 60 * 1000; // 10 minutes for building

// Dataset capability - which datasets support unit-level queries
const DATASET_CAPABILITIES = {
  violations: false, // DOB Violations - building-level (BIN/BBL)
  ecb: false,        // ECB - building-level (BBL)
  permits: false,    // Permits - building-level (BIN)
  safety: false,     // Safety - building-level (BIN)
  hpd: false,        // HPD - building-level (BBL)
};

async function fetchEndpoint(
  baseUrl: string,
  endpoint: string,
  bbl: string,
  apiKey: string,
  signal: AbortSignal
): Promise<{ totalApprox: number; items: Array<{ status: string; issueDate?: string; resolvedDate?: string }> }> {
  const params = new URLSearchParams({ bbl, limit: '200' });
  try {
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
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    console.warn(`Error fetching ${endpoint}:`, err);
    return { totalApprox: 0, items: [] };
  }
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

async function fetchScopeSummary(
  bbl: string,
  signal: AbortSignal
): Promise<ScopeSummary> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const [violationsRes, ecbRes, permitsRes, safetyRes, hpdViolationsRes] = await Promise.all([
    fetchDobViolationsDirect(bbl, { limit: 200, signal }),
    fetchEndpoint(baseUrl, 'dob-ecb', bbl, apiKey, signal),
    fetchEndpoint(baseUrl, 'dob-permits', bbl, apiKey, signal),
    fetchEndpoint(baseUrl, 'dob-safety', bbl, apiKey, signal),
    fetchEndpoint(baseUrl, 'hpd-violations', bbl, apiKey, signal),
  ]);

  const violationsOpen = violationsRes.items.filter(i => i.status === 'open').length;
  const ecbOpen = ecbRes.items.filter(i => i.status === 'open').length;
  const permitsOpen = permitsRes.items.filter(i => i.status === 'open').length;
  const safetyOpen = safetyRes.items.filter(i => i.status === 'open').length;
  const hpdOpen = hpdViolationsRes.items.filter(i => i.status === 'open').length;
  
  // Debug logging
  logRecordFetch('DOB Violations (scope)', `bbl=${bbl}`, { open: violationsOpen, total: violationsRes.items.length });
  logRecordFetch('ECB Violations (scope)', `bbl=${bbl}`, { open: ecbOpen, total: ecbRes.items.length });
  logRecordFetch('HPD Violations (scope)', `bbl=${bbl}`, { open: hpdOpen, total: hpdViolationsRes.items.length });

  return {
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
    hpd: {
      totalCount: hpdViolationsRes.totalApprox,
      openCount: hpdOpen,
      lastActivityDate: getLatestDate(hpdViolationsRes.items),
    },
    overall: {
      totalOpenCount: violationsOpen + ecbOpen + permitsOpen + safetyOpen + hpdOpen,
      overallLastActivityDate: getLatestDate([
        ...violationsRes.items,
        ...ecbRes.items,
        ...permitsRes.items,
        ...safetyRes.items,
        ...hpdViolationsRes.items,
      ]),
    },
  };
}

export function useDualScopeSummary(
  unitBbl: string | null,
  billingBbl: string | null
): UseDualScopeSummaryResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DualScopeSummaryData | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isValidBBL = (bbl: string | null) => bbl && bbl.length === 10;

  const fetchData = useCallback(async () => {
    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    setError(null);

    try {
      const now = Date.now();
      const promises: Promise<{ scope: 'unit' | 'building'; data: ScopeSummary | null }>[] = [];

      // Fetch unit scope if we have a valid unit BBL
      if (isValidBBL(unitBbl)) {
        const cachedUnit = unitCache.get(unitBbl!);
        if (cachedUnit && now - cachedUnit.timestamp < UNIT_CACHE_TTL) {
          promises.push(Promise.resolve({ scope: 'unit' as const, data: cachedUnit.data }));
        } else {
          promises.push(
            fetchScopeSummary(unitBbl!, signal).then(result => {
              unitCache.set(unitBbl!, { data: result, timestamp: Date.now() });
              return { scope: 'unit' as const, data: result };
            }).catch(() => ({ scope: 'unit' as const, data: null }))
          );
        }
      } else {
        promises.push(Promise.resolve({ scope: 'unit' as const, data: null }));
      }

      // Fetch building scope if we have a valid billing BBL (and it's different from unit)
      const buildingBblToUse = billingBbl || unitBbl;
      if (isValidBBL(buildingBblToUse) && buildingBblToUse !== unitBbl) {
        const cachedBuilding = buildingCache.get(buildingBblToUse!);
        if (cachedBuilding && now - cachedBuilding.timestamp < BUILDING_CACHE_TTL) {
          promises.push(Promise.resolve({ scope: 'building' as const, data: cachedBuilding.data }));
        } else {
          promises.push(
            fetchScopeSummary(buildingBblToUse!, signal).then(result => {
              buildingCache.set(buildingBblToUse!, { data: result, timestamp: Date.now() });
              return { scope: 'building' as const, data: result };
            }).catch(() => ({ scope: 'building' as const, data: null }))
          );
        }
      } else if (isValidBBL(buildingBblToUse) && buildingBblToUse === unitBbl) {
        // Same BBL for both - just use the unit result as building too
        promises.push(Promise.resolve({ scope: 'building' as const, data: null }));
      } else {
        promises.push(Promise.resolve({ scope: 'building' as const, data: null }));
      }

      const results = await Promise.allSettled(promises);
      
      let unitData: ScopeSummary | null = null;
      let buildingData: ScopeSummary | null = null;

      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          if (result.value.scope === 'unit') {
            unitData = result.value.data;
          } else {
            buildingData = result.value.data;
          }
        }
      });

      // If we don't have separate building data but have unit data, use unit for building display
      if (!buildingData && unitData && (!billingBbl || billingBbl === unitBbl)) {
        buildingData = unitData;
      }

      setData({
        unit: unitData,
        building: buildingData,
        isUnitCapable: DATASET_CAPABILITIES,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Error fetching dual scope summary:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch summary data');
    } finally {
      setLoading(false);
    }
  }, [unitBbl, billingBbl]);

  useEffect(() => {
    if (!isValidBBL(unitBbl) && !isValidBBL(billingBbl)) {
      setLoading(false);
      setData(null);
      return;
    }

    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData, unitBbl, billingBbl]);

  return { loading, error, data, unitBbl, billingBbl };
}

export function clearDualScopeSummaryCache() {
  unitCache.clear();
  buildingCache.clear();
}
