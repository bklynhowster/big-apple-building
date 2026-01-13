import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ArchivesPhotoResult {
  ok: boolean;
  itemUrl: string | null;
  thumbnailUrl: string | null;
  searchUrl: string;
  error?: string;
  debug?: {
    block?: string;
    lot?: string;
    step?: string;
    details?: string;
  };
}

/**
 * Parse BBL to extract block and lot
 * BBL format: 1 digit borough + 5 digit block + 4 digit lot
 */
export function getBlockLotFromBBL(bbl: string): { block: string; lot: string } | null {
  const cleaned = bbl.replace(/\D/g, '');
  if (cleaned.length !== 10) return null;
  
  // Block is chars 2-6 (5 digits), remove leading zeros
  const block = parseInt(cleaned.substring(1, 6), 10).toString();
  // Lot is chars 7-10 (4 digits), remove leading zeros
  const lot = parseInt(cleaned.substring(6, 10), 10).toString();
  
  return { block, lot };
}

async function fetchArchivesPhoto(block: string, lot: string): Promise<ArchivesPhotoResult> {
  const fallbackSearchUrl = `https://nycrecords.access.preservica.com/?q=${encodeURIComponent(`block=${block} AND lot=${lot}`)}`;
  
  try {
    const { data, error } = await supabase.functions.invoke('archives-photo', {
      body: { block, lot },
    });

    if (error) {
      console.error('Supabase function invoke error:', error);
      return {
        ok: false,
        itemUrl: null,
        thumbnailUrl: null,
        searchUrl: fallbackSearchUrl,
        error: error.message || 'Failed to invoke edge function',
      };
    }

    // Handle case where data might be a string or malformed
    if (typeof data === 'string') {
      try {
        return JSON.parse(data) as ArchivesPhotoResult;
      } catch {
        return {
          ok: false,
          itemUrl: null,
          thumbnailUrl: null,
          searchUrl: fallbackSearchUrl,
          error: 'Non-JSON response from edge function',
          debug: { details: data.slice(0, 300) },
        };
      }
    }

    // If data is already an object, validate it has expected shape
    if (data && typeof data === 'object') {
      return {
        ok: data.ok ?? false,
        itemUrl: data.itemUrl ?? null,
        thumbnailUrl: data.thumbnailUrl ?? null,
        searchUrl: data.searchUrl ?? fallbackSearchUrl,
        error: data.error,
        debug: data.debug,
      };
    }

    return {
      ok: false,
      itemUrl: null,
      thumbnailUrl: null,
      searchUrl: fallbackSearchUrl,
      error: 'Unexpected response format',
    };
  } catch (err) {
    console.error('Error fetching archives photo:', err);
    return {
      ok: false,
      itemUrl: null,
      thumbnailUrl: null,
      searchUrl: fallbackSearchUrl,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export function useArchivesPhoto(block: string | null, lot: string | null) {
  return useQuery({
    queryKey: ['archives-photo', block, lot],
    queryFn: () => fetchArchivesPhoto(block!, lot!),
    enabled: !!block && !!lot,
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
    retry: 1,
  });
}
