import { useEffect, useState } from "react";
import { getLandmarkStatus, type LandmarkResult } from "@/lib/landmarks";

export interface LandmarkStatus {
  isLoading: boolean;
  status: 'yes' | 'no' | 'unknown';
  isIndividual: boolean;
  isHistoricDistrict: boolean;
  individualName?: string;
  individualDate?: string;
  districtName?: string;
  error?: string;
}

export function useLandmarkStatus(params: {
  bbl?: string | number;
  lat?: number;
  lon?: number;
}): LandmarkStatus {
  const [state, setState] = useState<LandmarkStatus>({
    isLoading: false,
    status: 'unknown',
    isIndividual: false,
    isHistoricDistrict: false,
  });

  useEffect(() => {
    const { bbl, lat, lon } = params;
    const bblStr = bbl?.toString() ?? "";
    const hasBbl = bblStr.length === 10;
    
    if (!hasBbl) return;

    let cancelled = false;

    async function run() {
      setState(s => ({ ...s, isLoading: true, error: undefined }));

      try {
        const result: LandmarkResult = await getLandmarkStatus({
          bbl: bblStr,
          lat,
          lon,
        });

        if (cancelled) return;

        setState({
          isLoading: false,
          status: result.status,
          isIndividual: result.isIndividual,
          isHistoricDistrict: result.isHistoricDistrict,
          individualName: result.individualName,
          individualDate: result.individualDate,
          districtName: result.districtName,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to check landmark status";
        setState({
          isLoading: false,
          status: 'unknown',
          isIndividual: false,
          isHistoricDistrict: false,
          error: message,
        });
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [params.bbl, params.lat, params.lon]);

  return state;
}
