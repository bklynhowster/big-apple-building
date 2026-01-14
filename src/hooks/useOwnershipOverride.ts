import { useState, useEffect, useCallback } from 'react';

export type OwnershipOverrideType = 'COOP' | 'NOT_COOP' | null;

interface UseOwnershipOverrideResult {
  override: OwnershipOverrideType;
  setOverride: (value: OwnershipOverrideType) => void;
  clearOverride: () => void;
  isCoopEffective: boolean;
}

const STORAGE_KEY_PREFIX = 'elk_override:';

function getStorageKey(bbl: string): string {
  return `${STORAGE_KEY_PREFIX}${bbl}`;
}

export function useOwnershipOverride(
  bbl: string | null,
  isCoopInferred: boolean
): UseOwnershipOverrideResult {
  const [override, setOverrideState] = useState<OwnershipOverrideType>(null);

  // Load override from localStorage on mount or BBL change
  useEffect(() => {
    if (!bbl) {
      setOverrideState(null);
      return;
    }

    try {
      const stored = localStorage.getItem(getStorageKey(bbl));
      if (stored === 'COOP' || stored === 'NOT_COOP') {
        setOverrideState(stored);
      } else {
        setOverrideState(null);
      }
    } catch (e) {
      console.warn('Failed to read ownership override from localStorage:', e);
      setOverrideState(null);
    }
  }, [bbl]);

  const setOverride = useCallback((value: OwnershipOverrideType) => {
    if (!bbl) return;

    setOverrideState(value);

    try {
      if (value === null) {
        localStorage.removeItem(getStorageKey(bbl));
      } else {
        localStorage.setItem(getStorageKey(bbl), value);
      }
    } catch (e) {
      console.warn('Failed to save ownership override to localStorage:', e);
    }
  }, [bbl]);

  const clearOverride = useCallback(() => {
    setOverride(null);
  }, [setOverride]);

  // Compute effective co-op status
  const isCoopEffective = override !== null 
    ? override === 'COOP' 
    : isCoopInferred;

  return {
    override,
    setOverride,
    clearOverride,
    isCoopEffective,
  };
}
