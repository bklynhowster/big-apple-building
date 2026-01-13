import { useEffect, useState } from "react";
import { getLandmarkStatus, normalizeBBL, type LandmarkResult } from "@/lib/landmarks";

export interface LandmarkStatus {
  isLoading: boolean;
  status: 'yes' | 'no' | 'unknown';
  isIndividual: boolean;
  isHistoricDistrict: boolean;
  individualName?: string;
  individualDate?: string;
  districtName?: string;
  error?: string;
  debugReason?: string;
}

export function useLandmarkStatus(params: {
  bbl?: string | number;
  bin?: string;
  lat?: number;
  lon?: number;
  plutoHistDist?: string | null;
}): LandmarkStatus {
  const [state, setState] = useState<LandmarkStatus>({
    isLoading: false,
    status: 'unknown',
    isIndividual: false,
    isHistoricDistrict: false,
  });

  useEffect(() => {
    const { bbl, bin, lat, lon, plutoHistDist } = params;
    const bblNormalized = normalizeBBL(bbl);
    
    if (!bblNormalized) {
      setState(s => ({
        ...s,
        isLoading: false,
        status: 'unknown',
        debugReason: 'missing_bbl',
      }));
      return;
    }

    let cancelled = false;

    async function run() {
      setState(s => ({ ...s, isLoading: true, error: undefined }));

      try {
        const result: LandmarkResult = await getLandmarkStatus({
          bbl: bblNormalized!,
          bin,
          lat,
          lon,
          plutoHistDist,
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
          debugReason: result.debugReason,
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
          debugReason: 'exception',
        });
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [params.bbl, params.bin, params.lat, params.lon, params.plutoHistDist]);

  return state;
}
