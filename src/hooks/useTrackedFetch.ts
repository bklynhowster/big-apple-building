import { useCallback, useRef } from 'react';
import { useQueryDebugOptional } from '@/contexts/QueryDebugContext';

interface TrackedFetchOptions {
  endpoint: string;
  dataset?: string;
}

/**
 * Hook that wraps fetch to automatically log requests to the debug panel
 */
export function useTrackedFetch(options: TrackedFetchOptions) {
  const debugContext = useQueryDebugOptional();
  const loggedUrlsRef = useRef<Set<string>>(new Set());

  const trackedFetch = useCallback(async (
    url: string,
    params: Record<string, string>,
    fetchOptions?: RequestInit
  ): Promise<Response> => {
    const startTime = Date.now();
    
    // Determine scope from params
    const lot = params.bbl ? parseInt(params.bbl.slice(6), 10) : 0;
    const scope: 'unit' | 'building' | undefined = 
      params.scope as 'unit' | 'building' | undefined ??
      (lot >= 1001 && lot <= 6999 ? 'unit' : lot >= 7501 && lot <= 7599 ? 'building' : undefined);

    // Log to debug context if available
    let queryId: string | undefined;
    if (debugContext?.isDebugMode) {
      queryId = debugContext.logQuery({
        endpoint: options.endpoint,
        requestUrl: url,
        params,
        dataset: options.dataset,
        scope,
        status: 'pending',
      });
    }

    // Also log to console for debugging (only once per unique URL)
    if (!loggedUrlsRef.current.has(url)) {
      console.log(`[${options.endpoint}] fetching:`, url, 'params:', params);
      loggedUrlsRef.current.add(url);
    }

    try {
      const response = await fetch(url, fetchOptions);
      const responseTime = Date.now() - startTime;

      if (queryId && debugContext) {
        debugContext.updateQueryStatus(queryId, response.ok ? 'success' : 'error', responseTime);
      }

      return response;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      if (queryId && debugContext) {
        debugContext.updateQueryStatus(queryId, 'error', responseTime);
      }
      throw error;
    }
  }, [debugContext, options.endpoint, options.dataset]);

  return { trackedFetch };
}
