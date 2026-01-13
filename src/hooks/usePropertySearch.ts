import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PropertyInfo, Borough } from '@/types/property';

// Normalize BBL to 10 digits
function normalizeBBL(bbl: string | number | null | undefined): string | null {
  if (!bbl) return null;
  const normalized = String(bbl).padStart(10, '0');
  return normalized.length === 10 ? normalized : null;
}

interface UsePropertySearchResult {
  loading: boolean;
  error: string | null;
  propertyInfo: PropertyInfo | null;
  bbl: string | null;
}

/**
 * Hook for geocoding a property search and navigating to the results page.
 * Used on the search form page, NOT on the results page.
 */
export function usePropertySearch(): UsePropertySearchResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [propertyInfo, setPropertyInfo] = useState<PropertyInfo | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Check if BBL is already in URL (for page refresh)
  const urlBBL = normalizeBBL(searchParams.get('bbl'));

  const fetchData = useCallback(async () => {
    // Only run if we have a 'type' param (meaning we came from search form)
    const type = searchParams.get('type');
    if (!type) {
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    if (isMountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      // Build query params for the geocode function
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode`;
      const queryParams = new URLSearchParams();
      queryParams.set('type', type);

      if (type === 'address') {
        const house = searchParams.get('house') || '';
        const streetName = searchParams.get('streetName') || '';
        const streetType = searchParams.get('streetType') || '';
        const borough = searchParams.get('borough') || 'MANHATTAN';
        
        queryParams.set('house', house);
        queryParams.set('streetName', streetName);
        queryParams.set('streetType', streetType);
        queryParams.set('borough', borough);
      } else if (type === 'bbl') {
        const boroughCode = searchParams.get('borough') || '1';
        const block = searchParams.get('block') || '00001';
        const lot = searchParams.get('lot') || '0001';
        
        queryParams.set('borough', boroughCode);
        queryParams.set('block', block);
        queryParams.set('lot', lot);
      } else {
        throw new Error('Invalid search type');
      }

      const fullUrl = `${baseUrl}?${queryParams.toString()}`;
      console.log('Calling geocode API:', fullUrl);

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        signal,
      });

      // Check if request was aborted
      if (signal.aborted) return;

      let responseData: Record<string, unknown>;
      try {
        responseData = await response.json();
      } catch {
        throw new Error(`Failed to parse response: HTTP ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(
          (responseData.error as string) || 
          (responseData.details as string) || 
          `HTTP ${response.status}`
        );
      }

      // Check if still mounted
      if (!isMountedRef.current) return;

      console.log('Geocode result:', responseData);

      // Normalize BBL to ensure 10 digits
      const normalizedBBL = normalizeBBL(responseData.bbl as string);
      
      if (!normalizedBBL) {
        throw new Error('Invalid BBL returned from geocoding');
      }
      
      const info: PropertyInfo = {
        address: responseData.address as string,
        borough: responseData.borough as Borough,
        block: responseData.block as string,
        lot: responseData.lot as string,
        bbl: normalizedBBL,
        bin: responseData.bin as string,
      };

      if (isMountedRef.current) {
        setPropertyInfo(info);
      }

      // Update URL with BBL for persistence across refresh
      // Replace the URL with just ?bbl=...
      const nextParams = new URLSearchParams();
      nextParams.set('bbl', normalizedBBL);
      setSearchParams(nextParams, { replace: true });

    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Error fetching property data:', err);
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch property data');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchData();

    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchData]);

  return { 
    loading, 
    error, 
    propertyInfo, 
    bbl: propertyInfo?.bbl || urlBBL 
  };
}
