import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ArchivesPhotoResult {
  itemUrl: string | null;
  thumbnailUrl: string | null;
  searchUrl: string;
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
  // Lot is chars 7-10 (4 digits), keep as-is (some lots have meaningful leading structure)
  const lot = parseInt(cleaned.substring(6, 10), 10).toString();
  
  return { block, lot };
}

async function fetchArchivesPhoto(block: string, lot: string): Promise<ArchivesPhotoResult> {
  const { data, error } = await supabase.functions.invoke('archives-photo', {
    body: { block, lot },
  });

  if (error) {
    console.error('Error fetching archives photo:', error);
    throw error;
  }

  return data as ArchivesPhotoResult;
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
