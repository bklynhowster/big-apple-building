import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchPropertyProfile } from '@/utils/propertyClassification';
import { type ApiError } from '@/types/api-error';

export type PropertyTypeLabel = 'Condo' | 'Co-op' | '1-2 Family' | '3+ Family' | 'Mixed-Use' | 'Commercial' | 'Other' | 'Unknown';
export type PropertyTenure = 'CONDO' | 'COOP' | 'RENTAL_OR_OTHER' | 'UNKNOWN';

// Layer 1: Municipal Classification
export type MunicipalOwnershipLabel = 'Condominium' | 'Ownership type not specified in municipal data';

export interface MunicipalClassification {
  label: MunicipalOwnershipLabel;
  evidence: string[];
  source: string;
}

// Layer 2: Ownership Structure with scoring
export type OwnershipConfidenceLevel = 'Confirmed' | 'Market-known' | 'Unverified';
export type InferredConfidenceLevel = 'Low' | 'Medium' | 'High';
export type OwnershipStructureType = 'Condominium' | 'Cooperative' | 'Unknown';

export interface OwnershipStructure {
  type: OwnershipStructureType;
  confidence: OwnershipConfidenceLevel;
  inferredConfidence: InferredConfidenceLevel;
  coopLikelihoodScore: number;
  indicators: string[];
  sources: string[];
  disclaimerKey: 'unverified' | 'market-known';
}

export interface PropertyProfile {
  bbl: string;
  borough: string | null;
  block: string | null;
  lot: string | null;
  address: string | null;
  landUse: string | null;
  buildingClass: string | null;
  propertyTypeLabel: PropertyTypeLabel;
  propertyTenure: PropertyTenure;
  // Two-layer ownership classification
  municipal: MunicipalClassification;
  ownership: OwnershipStructure;
  ownershipWarnings: string[];
  residentialUnits: number | null;
  totalUnits: number | null;
  yearBuilt: number | null;
  grossSqFt: number | null;
  lotArea: number | null;
  numFloors: number | null;
  zipCode: string | null;
  ownerName: string | null;
  source: {
    datasetId: string;
    fieldsUsed: string[];
  };
  raw: Record<string, unknown>;
  requestId: string;
}

interface UsePropertyProfileResult {
  loading: boolean;
  error: ApiError | null;
  profile: PropertyProfile | null;
  retry: () => void;
}

// In-memory cache
const cache = new Map<string, { data: PropertyProfile; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export function usePropertyProfile(bbl?: string | null): UsePropertyProfileResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [profile, setProfile] = useState<PropertyProfile | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchedBblRef = useRef<string | null>(null);

  const blocked = !bbl || bbl.length !== 10;

  const fetchProfile = useCallback(async () => {
    if (blocked || !bbl) {
      setLoading(false);
      return;
    }

    // Skip if already fetched this BBL
    if (fetchedBblRef.current === bbl && profile) {
      return;
    }

    // Check cache
    const cached = cache.get(bbl);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setProfile(cached.data);
      setLoading(false);
      fetchedBblRef.current = bbl;
      return;
    }

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      // Client-side: hit PLUTO directly and classify locally
      const data = await fetchPropertyProfile(bbl, abortControllerRef.current.signal);
      setProfile(data);
      setError(null);
      fetchedBblRef.current = bbl;

      // Cache the result
      cache.set(bbl, { data, timestamp: Date.now() });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Error fetching property profile:', err);
      setError({
        error: 'Fetch error',
        details: err instanceof Error ? err.message : 'Unknown error',
        userMessage: 'Unable to load property profile. Please try again.',
        requestId: 'unknown',
      });
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [bbl, blocked, profile]);

  useEffect(() => {
    if (blocked) {
      setLoading(false);
      return;
    }

    fetchProfile();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [bbl, blocked, fetchProfile]);

  const retry = useCallback(() => {
    fetchedBblRef.current = null;
    fetchProfile();
  }, [fetchProfile]);

  return {
    loading: blocked ? false : loading,
    error: blocked ? null : error,
    profile: blocked ? null : profile,
    retry,
  };
}
