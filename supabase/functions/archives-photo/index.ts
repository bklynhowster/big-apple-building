import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;

interface ArchivesPhotoResponse {
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

function jsonResponse(data: ArchivesPhotoResponse, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract the first Preservica item URL from text content
 * Tries multiple patterns to find item links
 */
function extractItemUrl(text: string): string | null {
  // Pattern 1: Full absolute URL
  const absoluteMatch = text.match(/https?:\/\/nycrecords\.access\.preservica\.com\/uncategorized\/IO_[a-zA-Z0-9\-_]+\/?/);
  if (absoluteMatch) {
    console.log('Found absolute URL match');
    return absoluteMatch[0];
  }
  
  // Pattern 2: href attribute with relative path
  const hrefMatch = text.match(/href=["']?(\/uncategorized\/IO_[a-zA-Z0-9\-_]+\/?)/i);
  if (hrefMatch) {
    console.log('Found href relative match');
    return `https://nycrecords.access.preservica.com${hrefMatch[1]}`;
  }
  
  // Pattern 3: Any relative path
  const relativeMatch = text.match(/\/uncategorized\/IO_[a-zA-Z0-9\-_]+\/?/);
  if (relativeMatch) {
    console.log('Found relative path match');
    return `https://nycrecords.access.preservica.com${relativeMatch[0]}`;
  }
  
  // Pattern 4: Look for IO_ UUIDs in any context
  const ioMatch = text.match(/IO_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  if (ioMatch) {
    console.log('Found IO UUID match');
    return `https://nycrecords.access.preservica.com/uncategorized/${ioMatch[0]}/`;
  }
  
  return null;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let block: string | undefined;
  let lot: string | undefined;
  let step = 'init';

  try {
    // Parse request body
    step = 'parse_request';
    let body: { block?: string; lot?: string };
    
    try {
      const text = await req.text();
      if (!text || text.trim() === '') {
        return jsonResponse({
          ok: false,
          itemUrl: null,
          thumbnailUrl: null,
          searchUrl: '',
          error: 'Empty request body',
          debug: { step },
        }, 400);
      }
      body = JSON.parse(text);
    } catch (parseError) {
      return jsonResponse({
        ok: false,
        itemUrl: null,
        thumbnailUrl: null,
        searchUrl: '',
        error: 'Invalid JSON in request body',
        debug: { step, details: String(parseError) },
      }, 400);
    }

    block = body.block;
    lot = body.lot;

    // Validate input
    step = 'validate_input';
    if (!block || !lot) {
      return jsonResponse({
        ok: false,
        itemUrl: null,
        thumbnailUrl: null,
        searchUrl: '',
        error: 'Missing block or lot parameter',
        debug: { block, lot, step },
      }, 400);
    }

    console.log(`Searching archives for block=${block}, lot=${lot}`);

    // Build search URL - fetch directly (edge function bypasses CORS)
    const searchQuery = `block=${block} AND lot=${lot}`;
    const searchUrl = `https://nycrecords.access.preservica.com/?q=${encodeURIComponent(searchQuery)}`;
    
    console.log(`Search URL: ${searchUrl}`);

    // Fetch search page directly (server-side, no CORS issues)
    step = 'search_fetch';
    let searchText: string;
    
    try {
      const searchResponse = await fetchWithTimeout(searchUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      if (!searchResponse.ok) {
        console.log(`Search page returned status: ${searchResponse.status}`);
        return jsonResponse({
          ok: true,
          itemUrl: null,
          thumbnailUrl: null,
          searchUrl,
          error: `Search page returned status ${searchResponse.status}`,
          debug: { block, lot, step },
        });
      }

      searchText = await searchResponse.text();
      console.log(`Search text length: ${searchText.length}`);
      
      // Log a snippet for debugging
      if (searchText.length > 0) {
        console.log(`Search text snippet: ${searchText.substring(0, 500)}`);
      }
      
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error && fetchError.name === 'AbortError' 
        ? 'Search page request timed out' 
        : `Search page fetch failed: ${String(fetchError)}`;
      console.error(errorMsg);
      return jsonResponse({
        ok: true,
        itemUrl: null,
        thumbnailUrl: null,
        searchUrl,
        error: errorMsg,
        debug: { block, lot, step },
      });
    }

    // Extract first item URL from text
    step = 'search_parse';
    const itemUrl = extractItemUrl(searchText);
    
    if (!itemUrl) {
      console.log('No item link found in search results');
      return jsonResponse({
        ok: true,
        itemUrl: null,
        thumbnailUrl: null,
        searchUrl,
        debug: { block, lot, step: 'no_results' },
      });
    }

    console.log(`Found item URL: ${itemUrl}`);

    // Return result without fetching item page (no thumbnail in Phase 1)
    return jsonResponse({
      ok: true,
      itemUrl,
      thumbnailUrl: null,
      searchUrl,
      debug: { block, lot, step: 'complete' },
    });

  } catch (error: unknown) {
    console.error('Unhandled error in archives-photo function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({
      ok: false,
      itemUrl: null,
      thumbnailUrl: null,
      searchUrl: block && lot 
        ? `https://nycrecords.access.preservica.com/?q=${encodeURIComponent(`block=${block} AND lot=${lot}`)}`
        : '',
      error: errorMessage,
      debug: { block, lot, step },
    }, 500);
  }
});
