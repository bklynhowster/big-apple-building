import { useState, useEffect, useRef, useCallback } from 'react';
import { parseApiError, type ApiError } from '@/types/api-error';

export type PropertyTypeLabel = 'Condo' | 'Co-op' | '1-2 Family' | '3+ Family' | 'Mixed-Use' | 'Commercial' | 'Other' | 'Unknown';
export type PropertyTenure = 'CONDO' | 'COOP' | 'RENTAL_OR_OTHER' | 'UNKNOWN';
export type OwnershipConfidence = 'high' | 'medium' | 'low';

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
  // New ownership classification with confidence
  ownershipTypeLabel: string;
  ownershipConfidence: OwnershipConfidence;
  ownershipEvidence: string[];
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
      const baseUrl = import.meta.env.VITE_SUPABASE_URL;
      const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      const response = await fetch(
        `${baseUrl}/functions/v1/property-profile?bbl=${bbl}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': apiKey,
          },
          signal: abortControllerRef.current.signal,
        }
      );

      if (!response.ok) {
        const apiError = await parseApiError(response);
        setError(apiError);
        setProfile(null);
        return;
      }

      const data: PropertyProfile = await response.json();
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
        error: 'Network error',
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
