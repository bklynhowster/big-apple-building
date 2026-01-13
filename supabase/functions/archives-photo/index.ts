import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 8000;

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

    // Build search URL
    const searchQuery = `block=${block} AND lot=${lot}`;
    const searchUrl = `https://nycrecords.access.preservica.com/?q=${encodeURIComponent(searchQuery)}`;
    
    console.log(`Search URL: ${searchUrl}`);

    // Fetch search page
    step = 'search_fetch';
    let searchResponse: Response;
    try {
      searchResponse = await fetchWithTimeout(searchUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error && fetchError.name === 'AbortError' 
        ? 'Search page request timed out' 
        : `Search page fetch failed: ${String(fetchError)}`;
      console.error(errorMsg);
      return jsonResponse({
        ok: false,
        itemUrl: null,
        thumbnailUrl: null,
        searchUrl,
        error: errorMsg,
        debug: { block, lot, step },
      });
    }

    if (!searchResponse.ok) {
      console.log(`Search page returned status: ${searchResponse.status}`);
      return jsonResponse({
        ok: false,
        itemUrl: null,
        thumbnailUrl: null,
        searchUrl,
        error: `Search page returned status ${searchResponse.status}`,
        debug: { block, lot, step },
      });
    }

    // Parse search HTML
    step = 'search_parse';
    let searchHtml: string;
    try {
      searchHtml = await searchResponse.text();
    } catch (textError) {
      return jsonResponse({
        ok: false,
        itemUrl: null,
        thumbnailUrl: null,
        searchUrl,
        error: `Failed to read search page: ${String(textError)}`,
        debug: { block, lot, step },
      });
    }
    
    console.log(`Search HTML length: ${searchHtml.length}`);

    // Look for item links matching /uncategorized/IO_.../ pattern
    const itemLinkMatch = searchHtml.match(/href=["']([^"']*\/uncategorized\/IO_[^"']*)/i);
    
    if (!itemLinkMatch) {
      console.log('No item link found in search results');
      return jsonResponse({
        ok: true,
        itemUrl: null,
        thumbnailUrl: null,
        searchUrl,
        debug: { block, lot, step: 'no_results' },
      });
    }

    // Construct full item URL
    let itemPath = itemLinkMatch[1];
    if (!itemPath.startsWith('/')) {
      itemPath = '/' + itemPath;
    }
    const itemUrl = `https://nycrecords.access.preservica.com${itemPath}`;
    console.log(`Found item URL: ${itemUrl}`);

    // Fetch item page to get thumbnail
    step = 'item_fetch';
    let itemResponse: Response;
    try {
      itemResponse = await fetchWithTimeout(itemUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error && fetchError.name === 'AbortError'
        ? 'Item page request timed out'
        : `Item page fetch failed: ${String(fetchError)}`;
      console.error(errorMsg);
      return jsonResponse({
        ok: true,
        itemUrl,
        thumbnailUrl: null,
        searchUrl,
        error: errorMsg,
        debug: { block, lot, step },
      });
    }

    if (!itemResponse.ok) {
      console.log(`Item page returned status: ${itemResponse.status}`);
      return jsonResponse({
        ok: true,
        itemUrl,
        thumbnailUrl: null,
        searchUrl,
        error: `Item page returned status ${itemResponse.status}`,
        debug: { block, lot, step },
      });
    }

    // Parse item HTML
    step = 'item_parse';
    let itemHtml: string;
    try {
      itemHtml = await itemResponse.text();
    } catch (textError) {
      return jsonResponse({
        ok: true,
        itemUrl,
        thumbnailUrl: null,
        searchUrl,
        error: `Failed to read item page: ${String(textError)}`,
        debug: { block, lot, step },
      });
    }
    
    console.log(`Item HTML length: ${itemHtml.length}`);

    // Try to extract thumbnail URL
    let thumbnailUrl: string | null = null;

    // First try og:image meta tag
    const ogImageMatch = itemHtml.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                         itemHtml.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
    
    if (ogImageMatch) {
      thumbnailUrl = ogImageMatch[1];
      console.log(`Found og:image thumbnail: ${thumbnailUrl}`);
    }

    // If no og:image, try to find any download image link
    if (!thumbnailUrl) {
      const downloadMatch = itemHtml.match(/https:\/\/[^"'\s]+\/download\?[^"'\s]+/i);
      if (downloadMatch) {
        thumbnailUrl = downloadMatch[0];
        console.log(`Found download thumbnail: ${thumbnailUrl}`);
      }
    }

    // Try to find image in content area
    if (!thumbnailUrl) {
      const imgMatch = itemHtml.match(/<img[^>]+src=["'](https:\/\/[^"']+(?:\.jpg|\.jpeg|\.png|\.gif|download\?)[^"']*)["']/i);
      if (imgMatch) {
        thumbnailUrl = imgMatch[1];
        console.log(`Found img src thumbnail: ${thumbnailUrl}`);
      }
    }

    console.log(`Final result: itemUrl=${itemUrl}, thumbnailUrl=${thumbnailUrl}`);

    return jsonResponse({
      ok: true,
      itemUrl,
      thumbnailUrl,
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
