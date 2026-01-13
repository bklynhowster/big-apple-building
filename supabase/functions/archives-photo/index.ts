import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { block, lot } = await req.json();
    
    if (!block || !lot) {
      console.log('Missing block or lot parameter');
      return new Response(
        JSON.stringify({ error: 'Missing block or lot parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Searching archives for block=${block}, lot=${lot}`);

    // Build search URL
    const searchQuery = `block=${block} AND lot=${lot}`;
    const searchUrl = `https://nycrecords.access.preservica.com/?q=${encodeURIComponent(searchQuery)}`;
    
    console.log(`Search URL: ${searchUrl}`);

    // Fetch search page
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!searchResponse.ok) {
      console.log(`Search page fetch failed: ${searchResponse.status}`);
      return new Response(
        JSON.stringify({ itemUrl: null, thumbnailUrl: null, searchUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const searchHtml = await searchResponse.text();
    console.log(`Search HTML length: ${searchHtml.length}`);

    // Look for item links matching /uncategorized/IO_.../ pattern
    const itemLinkMatch = searchHtml.match(/href=["']([^"']*\/uncategorized\/IO_[^"']*)/i);
    
    if (!itemLinkMatch) {
      console.log('No item link found in search results');
      return new Response(
        JSON.stringify({ itemUrl: null, thumbnailUrl: null, searchUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Construct full item URL
    let itemPath = itemLinkMatch[1];
    // Ensure path starts with /
    if (!itemPath.startsWith('/')) {
      itemPath = '/' + itemPath;
    }
    const itemUrl = `https://nycrecords.access.preservica.com${itemPath}`;
    console.log(`Found item URL: ${itemUrl}`);

    // Fetch item page to get thumbnail
    const itemResponse = await fetch(itemUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!itemResponse.ok) {
      console.log(`Item page fetch failed: ${itemResponse.status}`);
      return new Response(
        JSON.stringify({ itemUrl, thumbnailUrl: null, searchUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const itemHtml = await itemResponse.text();
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

    return new Response(
      JSON.stringify({ itemUrl, thumbnailUrl, searchUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in archives-photo function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage, itemUrl: null, thumbnailUrl: null }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
