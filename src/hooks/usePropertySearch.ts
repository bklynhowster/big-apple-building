import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import type { PropertyData, PropertyInfo, ECBViolation, SafetyViolation, Permit, Borough } from '@/types/property';

const BOROUGH_NAMES: Record<string, Borough> = {
  '1': 'MANHATTAN',
  '2': 'BRONX',
  '3': 'BROOKLYN',
  '4': 'QUEENS',
  '5': 'STATEN ISLAND',
};

// Generate mock data for tabs that aren't implemented yet
function generatePlaceholderData(info: PropertyInfo): Omit<PropertyData, 'info' | 'violations'> {
  const ecbViolations: ECBViolation[] = Array.from({ length: 8 }, (_, i) => ({
    id: `ecb-${i}`,
    ecbNumber: `ECB${Math.random().toString().slice(2, 12)}`,
    issueDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000 * 5).toISOString(),
    violationType: ['ZONING', 'BUILDING', 'CONSTRUCTION SAFETY', 'QUALITY OF LIFE'][Math.floor(Math.random() * 4)],
    description: [
      'Zoning violation: commercial use in residential zone',
      'Building code violation: improper egress',
      'Construction safety violation: missing safety barriers',
      'Quality of life violation: excessive noise',
    ][Math.floor(Math.random() * 4)],
    status: ['OPEN', 'RESOLVED', 'PENDING'][Math.floor(Math.random() * 3)] as 'OPEN' | 'RESOLVED' | 'PENDING',
    severity: ['HAZARDOUS', 'MAJOR', 'MINOR', 'UNKNOWN'][Math.floor(Math.random() * 4)] as ECBViolation['severity'],
    penaltyAmount: Math.random() > 0.3 ? Math.floor(Math.random() * 10000) + 500 : undefined,
    hearingDate: Math.random() > 0.5 ? new Date(Date.now() + Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString() : undefined,
  }));

  const safetyViolations: SafetyViolation[] = Array.from({ length: 5 }, (_, i) => ({
    id: `safety-${i}`,
    violationNumber: `HPD${Math.random().toString().slice(2, 10)}`,
    issueDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000 * 3).toISOString(),
    violationType: ['FIRE SAFETY', 'STRUCTURAL', 'LEAD PAINT', 'HEATING'][Math.floor(Math.random() * 4)],
    description: [
      'Missing or defective smoke detectors in common areas',
      'Structural damage to exterior wall',
      'Presence of lead-based paint in residential unit',
      'Failure to provide adequate heat during heating season',
    ][Math.floor(Math.random() * 4)],
    status: ['OPEN', 'RESOLVED', 'PENDING'][Math.floor(Math.random() * 3)] as 'OPEN' | 'RESOLVED' | 'PENDING',
    class: ['A', 'B', 'C', 'I'][Math.floor(Math.random() * 4)] as SafetyViolation['class'],
  }));

  const permits: Permit[] = Array.from({ length: 15 }, (_, i) => ({
    id: `permit-${i}`,
    jobNumber: `B${Math.random().toString().slice(2, 10)}`,
    permitType: ['NEW BUILDING', 'ALTERATION TYPE 1', 'ALTERATION TYPE 2', 'DEMOLITION', 'PLUMBING', 'ELECTRICAL'][Math.floor(Math.random() * 6)],
    filingDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000 * 5).toISOString(),
    issueDate: Math.random() > 0.3 ? new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000 * 4).toISOString() : undefined,
    expirationDate: Math.random() > 0.5 ? new Date(Date.now() + Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString() : undefined,
    status: ['ISSUED', 'PENDING', 'EXPIRED', 'COMPLETED'][Math.floor(Math.random() * 4)] as Permit['status'],
    workType: ['GENERAL CONSTRUCTION', 'PLUMBING', 'ELECTRICAL', 'MECHANICAL', 'SPRINKLER'][Math.floor(Math.random() * 5)],
    description: [
      'Interior renovation of 3rd floor office space',
      'Installation of new plumbing fixtures',
      'Electrical upgrade to 200 amp service',
      'HVAC system replacement',
      'New sprinkler system installation',
    ][Math.floor(Math.random() * 5)],
  }));

  return {
    ecbViolations,
    safetyViolations,
    permits,
  };
}

// Normalize BBL to 10 digits
function normalizeBBL(bbl: string | number | null | undefined): string | null {
  if (!bbl) return null;
  const normalized = String(bbl).padStart(10, '0');
  return normalized.length === 10 ? normalized : null;
}

export function usePropertySearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PropertyData | null>(null);

  // Check if BBL is already in URL (for page refresh)
  const urlBBL = normalizeBBL(searchParams.get('bbl'));

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const type = searchParams.get('type');
        
        // If we already have BBL in URL and it's valid, we might have cached data
        // But still need to fetch property info from geocode
        
        let propertyInfo: PropertyInfo;

        // Build query params for the geocode function
        const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode`;
        const queryParams = new URLSearchParams();
        queryParams.set('type', type || 'address');

        if (type === 'address') {
          const house = searchParams.get('house') || '';
          const streetName = searchParams.get('streetName') || '';
          const streetType = searchParams.get('streetType') || '';
          const borough = searchParams.get('borough') || 'MANHATTAN';
          
          // Support new streetName/streetType params
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
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.details || `HTTP ${response.status}`);
        }

        const geocodeResult = await response.json();
        console.log('Geocode result:', geocodeResult);

        // Normalize BBL to ensure 10 digits
        const normalizedBBL = normalizeBBL(geocodeResult.bbl);
        
        if (!normalizedBBL) {
          throw new Error('Invalid BBL returned from geocoding');
        }
        
        propertyInfo = {
          address: geocodeResult.address,
          borough: geocodeResult.borough as Borough,
          block: geocodeResult.block,
          lot: geocodeResult.lot,
          bbl: normalizedBBL,
          bin: geocodeResult.bin,
        };

        // Update URL with BBL for persistence across refresh
        const currentParams = new URLSearchParams(searchParams);
        if (currentParams.get('bbl') !== normalizedBBL) {
          currentParams.set('bbl', normalizedBBL);
          // Use replace to not add to history
          setSearchParams(currentParams, { replace: true });
        }

        // Generate placeholder data for other tabs (will be replaced with real API calls later)
        const placeholderData = generatePlaceholderData(propertyInfo);
        
        setData({
          info: propertyInfo,
          violations: [], // Violations are now fetched separately by the ViolationsTab
          ...placeholderData,
        });
      } catch (err) {
        console.error('Error fetching property data:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch property data');
      } finally {
        setLoading(false);
      }
    };

    if (searchParams.get('type')) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [searchParams, setSearchParams]);

  // Return the BBL from URL as fallback for immediate access
  return { loading, error, data, bbl: data?.info?.bbl || urlBBL };
}
