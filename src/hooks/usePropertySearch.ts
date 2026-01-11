import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PropertyData, PropertyInfo, DOBViolation, ECBViolation, SafetyViolation, Permit, Borough } from '@/types/property';

// Mock data generator for demonstration
function generateMockData(info: PropertyInfo): PropertyData {
  const violations: DOBViolation[] = Array.from({ length: 12 }, (_, i) => ({
    id: `viol-${i}`,
    violationNumber: `V${Math.random().toString().slice(2, 10)}`,
    issueDate: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000 * 5).toISOString(),
    violationType: ['WORK WITHOUT PERMIT', 'ILLEGAL CONVERSION', 'FAILURE TO MAINTAIN', 'ELEVATOR SAFETY'][Math.floor(Math.random() * 4)],
    description: [
      'Work without permit: installation of HVAC system without required permits',
      'Failure to maintain building facade in a safe condition',
      'Illegal conversion of basement to residential use',
      'Failure to maintain elevator in safe operating condition',
    ][Math.floor(Math.random() * 4)],
    status: ['OPEN', 'RESOLVED', 'PENDING'][Math.floor(Math.random() * 3)] as 'OPEN' | 'RESOLVED' | 'PENDING',
    dispositionDate: Math.random() > 0.5 ? new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString() : undefined,
  }));

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
    info,
    violations,
    ecbViolations,
    safetyViolations,
    permits,
  };
}

const BOROUGH_NAMES: Record<string, Borough> = {
  '1': 'MANHATTAN',
  '2': 'BRONX',
  '3': 'BROOKLYN',
  '4': 'QUEENS',
  '5': 'STATEN ISLAND',
};

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
        // Simulate API delay
        await new Promise((resolve) => setTimeout(resolve, 1200));

        const type = searchParams.get('type');
        let propertyInfo: PropertyInfo;

        if (type === 'address') {
          const house = searchParams.get('house') || '';
          const street = searchParams.get('street') || '';
          const borough = searchParams.get('borough') as Borough || 'MANHATTAN';
          
          // In production, this would call NYC Geoclient API
          propertyInfo = {
            address: `${house} ${street}`.toUpperCase(),
            borough,
            block: String(Math.floor(Math.random() * 9999) + 1).padStart(5, '0'),
            lot: String(Math.floor(Math.random() * 999) + 1).padStart(4, '0'),
            bbl: '',
            bin: `1${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
          };
          propertyInfo.bbl = `${BOROUGH_NAMES[propertyInfo.borough] === 'MANHATTAN' ? '1' : 
            BOROUGH_NAMES[propertyInfo.borough] === 'BRONX' ? '2' : 
            BOROUGH_NAMES[propertyInfo.borough] === 'BROOKLYN' ? '3' : 
            BOROUGH_NAMES[propertyInfo.borough] === 'QUEENS' ? '4' : '5'}${propertyInfo.block}${propertyInfo.lot}`;
        } else if (type === 'bbl') {
          const boroughCode = searchParams.get('borough') || '1';
          const block = searchParams.get('block') || '00001';
          const lot = searchParams.get('lot') || '0001';
          
          propertyInfo = {
            address: `BLOCK ${block}, LOT ${lot}`,
            borough: BOROUGH_NAMES[boroughCode] || 'MANHATTAN',
            block: block.padStart(5, '0'),
            lot: lot.padStart(4, '0'),
            bbl: `${boroughCode}${block.padStart(5, '0')}${lot.padStart(4, '0')}`,
            bin: `${boroughCode}${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
          };
        } else {
          throw new Error('Invalid search type');
        }

        const mockData = generateMockData(propertyInfo);
        setData(mockData);
      } catch (err) {
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
