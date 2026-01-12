import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface JobFilingRecord {
  jobNumber: string;
  filingNumber: string | null;
  jobType: string | null;
  filingStatus: string | null;
  address: string | null;
  workOnFloors: string | null;
  jobDescription: string | null;
  modifiedDate: string | null;
  extractedUnits: string[];
  raw: Record<string, unknown>;
}

export interface FilingReference {
  jobNumber: string;
  jobType: string | null;
  status: string | null;
  modifiedDate: string | null;
  snippet: string | null;
}

export interface UnitFromFilings {
  unit: string;
  count: number;
  lastSeen: string | null;
  source: string;
  filings: FilingReference[];
}

export interface DobJobFilingsResponse {
  bin: string;
  filings: JobFilingRecord[];
  units: UnitFromFilings[];
  totalFilings: number;
  fallbackMode: boolean;
  dobNowUrl: string;
  requestId: string;
}

export interface UseDobJobFilingsReturn {
  loading: boolean;
  error: string | null;
  data: DobJobFilingsResponse | null;
  units: UnitFromFilings[];
  filings: JobFilingRecord[];
  fallbackMode: boolean;
  dobNowUrl: string | null;
  fetch: (bin: string) => Promise<void>;
  reset: () => void;
}

export function useDobJobFilings(): UseDobJobFilingsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DobJobFilingsResponse | null>(null);
  
  const lastBinRef = useRef<string | null>(null);

  const fetchData = useCallback(async (bin: string) => {
    if (!bin || bin.length < 7) {
      setError('Invalid BIN');
      return;
    }

    const normalizedBin = bin.padStart(7, '0');
    
    // Don't refetch if same BIN
    if (lastBinRef.current === normalizedBin && data) {
      return;
    }

    setLoading(true);
    setError(null);
    lastBinRef.current = normalizedBin;

    try {
      const { data: responseData, error: invokeError } = await supabase.functions.invoke(
        'dob-job-filings',
        {
          body: { bin: normalizedBin, limit: 100 },
        }
      );

      if (invokeError) {
        throw new Error(invokeError.message || 'Failed to fetch DOB job filings');
      }

      // Handle edge function error responses
      if (responseData?.error) {
        throw new Error(responseData.userMessage || responseData.error);
      }

      setData(responseData as DobJobFilingsResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(message);
      // Don't clear data on error - keep previous results if available
    } finally {
      setLoading(false);
    }
  }, [data]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(null);
    lastBinRef.current = null;
  }, []);

  return {
    loading,
    error,
    data,
    units: data?.units || [],
    filings: data?.filings || [],
    fallbackMode: data?.fallbackMode || false,
    dobNowUrl: data?.dobNowUrl || null,
    fetch: fetchData,
    reset,
  };
}

