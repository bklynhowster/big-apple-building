import { useEffect, useState } from "react";

export interface LandmarkStatus {
  isLoading: boolean;
  isLandmarked: boolean | null;   // null = unknown
  source: "LPC" | "N/A" | "error";
  designation?: string;           // optional text like "Individual Landmark" if available
  error?: string;
}

export function useLandmarkStatus(params: {
  bbl?: string | number;
  bin?: string | number;
}): LandmarkStatus {
  const [state, setState] = useState<LandmarkStatus>({
    isLoading: false,
    isLandmarked: null,
    source: "N/A",
  });

  useEffect(() => {
    const { bbl, bin } = params;
    const hasBbl = bbl !== undefined && bbl !== null && bbl !== "";
    const hasBin = bin !== undefined && bin !== null && bin !== "";
    
    if (!hasBbl && !hasBin) return;

    let cancelled = false;

    async function run() {
      setState(s => ({ ...s, isLoading: true, error: undefined }));

      try {
        // TODO: Implement actual landmark lookup here
        // Options:
        // 1. Call NYC LPC API directly via edge function
        // 2. Query NYC Open Data Landmarks dataset
        // 3. Use a cached landmarks table in Supabase
        //
        // For now, return "unknown" status to avoid build breaks
        
        if (cancelled) return;

        // STUB: Always return unknown status
        setState({
          isLoading: false,
          isLandmarked: null,
          source: "N/A",
        });
      } catch (e: unknown) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to check landmark status";
        setState({
          isLoading: false,
          isLandmarked: null,
          source: "error",
          error: message,
        });
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [params.bbl, params.bin]);

  return state;
}
