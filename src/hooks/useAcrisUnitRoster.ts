/**
 * React hook for fetching co-op unit roster from ACRIS.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchAcrisUnitRoster, type AcrisUnit, type AcrisUnitRosterResult } from '@/utils/acrisUnitRoster';

export type { AcrisUnit, AcrisTransaction, AcrisParty } from '@/utils/acrisUnitRoster';

export interface UseAcrisUnitRosterReturn {
  loading: boolean;
  error: string | null;
  units: AcrisUnit[];
  totalDocuments: number;
  fetch: (bbl: string) => void;
  reset: () => void;
}

export function useAcrisUnitRoster(): UseAcrisUnitRosterReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [units, setUnits] = useState<AcrisUnit[]>([]);
  const [totalDocuments, setTotalDocuments] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const lastBblRef = useRef<string | null>(null);

  const fetchData = useCallback((bbl: string, addressHint?: { streetNumber: string; streetName: string } | null) => {
    const normalized = String(bbl || '').trim().padStart(10, '0');

    if (!normalized || normalized.length !== 10) {
      setError('Invalid BBL');
      return;
    }

    // Don't refetch same BBL
    if (lastBblRef.current === normalized && units.length > 0) {
      return;
    }

    // Abort previous
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    lastBblRef.current = normalized;

    setLoading(true);
    setError(null);

    fetchAcrisUnitRoster(normalized, controller.signal, addressHint).then((result) => {
      if (controller.signal.aborted) return;

      if (result.error) {
        setError(result.error);
        setUnits([]);
        setTotalDocuments(0);
      } else {
        setUnits(result.units);
        setTotalDocuments(result.totalDocuments);
        setError(null);
      }
      setLoading(false);
    });
  }, [units.length]);

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setLoading(false);
    setError(null);
    setUnits([]);
    setTotalDocuments(0);
    lastBblRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return {
    loading,
    error,
    units,
    totalDocuments,
    fetch: fetchData,
    reset,
  };
}
