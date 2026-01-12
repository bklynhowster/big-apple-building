import { useEffect, useState } from "react";

export interface LandmarkStatus {
  isLandmarked: boolean | null;   // null = unknown
  landmarkName: string | null;
  landmarkType: string | null;
  source: string | null;
  loading: boolean;
  error: string | null;
}

export function useLandmarkStatus(params: {
  bbl?: string;
  bin?: string;
  lat?: number;
  lon?: number;
}): LandmarkStatus {
  const [state, setState] = useState<LandmarkStatus>({
    isLandmarked: null,
    landmarkName: null,
    landmarkType: null,
    source: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    const { bbl, bin, lat, lon } = params;
    const hasAnyKey = Boolean(bbl || bin || (lat && lon));
    if (!hasAnyKey) return;

    let cancelled = false;

    async function run() {
      setState(s => ({ ...s, loading: true, error: null }));

      try {
        // STUB — safe, no-op request
        if (cancelled) return;

        setState({
          isLandmarked: null,
          landmarkName: null,
          landmarkType: null,
          source: null,
          loading: false,
          error: null,
        });
      } catch (e: any) {
        if (cancelled) return;
        setState(s => ({
          ...s,
          loading: false,
          error: e?.message ?? "Failed to check landmark status",
        }));
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [params.bbl, params.bin, params.lat, params.lon]);

  return state;
}
