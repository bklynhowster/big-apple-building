import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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

export function usePropertySearch() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PropertyData | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const type = searchParams.get('type');
        let propertyInfo: PropertyInfo;

        // Build query params for the geocode function
        const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode`;
        const queryParams = new URLSearchParams();
        queryParams.set('type', type || 'address');

        if (type === 'address') {
          const house = searchParams.get('house') || '';
          const street = searchParams.get('street') || '';
          const borough = searchParams.get('borough') || 'MANHATTAN';
          
          queryParams.set('house', house);
          queryParams.set('street', street);
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
        const normalizedBBL = (geocodeResult.bbl || '').toString().padStart(10, '0');
        
        propertyInfo = {
          address: geocodeResult.address,
          borough: geocodeResult.borough as Borough,
          block: geocodeResult.block,
          lot: geocodeResult.lot,
          bbl: normalizedBBL,
          bin: geocodeResult.bin,
        };

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
    }
  }, [searchParams]);

  return { loading, error, data };
}
