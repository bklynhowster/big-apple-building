import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEOCLIENT_APP_ID = Deno.env.get('GEOCLIENT_APP_ID') || '';
const GEOCLIENT_APP_KEY = Deno.env.get('GEOCLIENT_APP_KEY') || '';

// Attempt A: API Gateway (subscription key in header)
const GEOCLIENT_API_GATEWAY_URL = 'https://api.nyc.gov/geoclient/v2';
// Attempt B: Maps NYC (app_id/app_key in query params)
const GEOCLIENT_MAPS_URL = 'https://maps.nyc.gov/geoclient/v2';

interface GeoclientResponse {
  address?: {
    bbl?: string;
    bblBoroughCode?: string;
    bblTaxBlock?: string;
    bblTaxLot?: string;
    buildingIdentificationNumber?: string;
    houseNumber?: string;
    firstStreetNameNormalized?: string;
    returnCode1a?: string;
    message?: string;
    latitude?: number;
    longitude?: number;
    [key: string]: unknown;
  };
  bbl?: {
    bbl?: string;
    bblBoroughCode?: string;
    bblTaxBlock?: string;
    bblTaxLot?: string;
    buildingIdentificationNumber?: string;
    giHighHouseNumber1?: string;
    giStreetName1?: string;
    latitude?: number;
    longitude?: number;
    [key: string]: unknown;
  };
}

interface PropertyInfo {
  address: string;
  borough: string;
  block: string;
  lot: string;
  bbl: string;
  bin?: string;
  latitude?: number;
  longitude?: number;
}

interface AttemptResult {
  attempt: 'A' | 'B';
  status: number;
  success: boolean;
  data?: GeoclientResponse;
  error?: string;
}

const BOROUGH_NAMES: Record<string, string> = {
  '1': 'Manhattan',
  '2': 'Bronx', 
  '3': 'Brooklyn',
  '4': 'Queens',
  '5': 'Staten Island',
  'MANHATTAN': 'Manhattan',
  'BRONX': 'Bronx',
  'BROOKLYN': 'Brooklyn',
  'QUEENS': 'Queens',
  'STATEN ISLAND': 'Staten Island',
  'MN': 'Manhattan',
  'BX': 'Bronx',
  'BK': 'Brooklyn',
  'QN': 'Queens',
  'SI': 'Staten Island',
};

const BOROUGH_CODES: Record<string, string> = {
  'MANHATTAN': '1',
  'BRONX': '2',
  'BROOKLYN': '3',
  'QUEENS': '4',
  'STATEN ISLAND': '5',
};

// Convert borough to Title Case for API
function toTitleCase(borough: string): string {
  const normalized = BOROUGH_NAMES[borough.toUpperCase()];
  return normalized || borough.charAt(0).toUpperCase() + borough.slice(1).toLowerCase();
}

// Attempt A: API Gateway with subscription key header
async function attemptApiGateway(
  endpoint: string,
  params: Record<string, string>
): Promise<AttemptResult> {
  const url = new URL(`${GEOCLIENT_API_GATEWAY_URL}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  console.log(`Attempt A (API Gateway): ${url.toString()}`);
  console.log(`Attempt A debug: hasAppId=${!!GEOCLIENT_APP_ID}, hasAppKey=${!!GEOCLIENT_APP_KEY}`);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'Ocp-Apim-Subscription-Key': GEOCLIENT_APP_KEY,
      },
    });

    const status = response.status;
    console.log(`Attempt A status: ${status}`);

    if (status === 401 || status === 403) {
      const errorText = await response.text();
      return { attempt: 'A', status, success: false, error: errorText };
    }

    if (!response.ok) {
      const errorText = await response.text();
      return { attempt: 'A', status, success: false, error: errorText };
    }

    const data: GeoclientResponse = await response.json();
    return { attempt: 'A', status, success: true, data };
  } catch (error) {
    console.error('Attempt A error:', error);
    return { attempt: 'A', status: 0, success: false, error: String(error) };
  }
}

// Attempt B: Maps NYC with app_id/app_key query params
async function attemptMapsNyc(
  endpoint: string,
  params: Record<string, string>
): Promise<AttemptResult> {
  if (!GEOCLIENT_APP_ID) {
    console.log('Attempt B skipped: no APP_ID configured');
    return { attempt: 'B', status: 0, success: false, error: 'No APP_ID configured' };
  }

  const url = new URL(`${GEOCLIENT_MAPS_URL}/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  url.searchParams.set('app_id', GEOCLIENT_APP_ID);
  url.searchParams.set('app_key', GEOCLIENT_APP_KEY);

  console.log(`Attempt B (Maps NYC): ${url.toString().replace(GEOCLIENT_APP_KEY, '[REDACTED]')}`);
  console.log(`Attempt B debug: hasAppId=${!!GEOCLIENT_APP_ID}, hasAppKey=${!!GEOCLIENT_APP_KEY}`);

  try {
    const response = await fetch(url.toString());
    const status = response.status;
    console.log(`Attempt B status: ${status}`);

    if (!response.ok) {
      const errorText = await response.text();
      return { attempt: 'B', status, success: false, error: errorText };
    }

    const data: GeoclientResponse = await response.json();
    return { attempt: 'B', status, success: true, data };
  } catch (error) {
    console.error('Attempt B error:', error);
    return { attempt: 'B', status: 0, success: false, error: String(error) };
  }
}

// Try both authentication methods
async function geoclientFetch(
  endpoint: string,
  params: Record<string, string>
): Promise<{ data: GeoclientResponse; attemptUsed: 'A' | 'B' } | { error: string; attempts: AttemptResult[] }> {
  // Attempt A first (API Gateway with subscription key)
  const attemptA = await attemptApiGateway(endpoint, params);
  if (attemptA.success && attemptA.data) {
    console.log('Attempt A succeeded');
    return { data: attemptA.data, attemptUsed: 'A' };
  }

  // If Attempt A failed with auth error, try Attempt B
  if (attemptA.status === 401 || attemptA.status === 403 || attemptA.status === 0) {
    const attemptB = await attemptMapsNyc(endpoint, params);
    if (attemptB.success && attemptB.data) {
      console.log('Attempt B succeeded');
      return { data: attemptB.data, attemptUsed: 'B' };
    }

    // Both failed
    return {
      error: 'Both authentication methods failed',
      attempts: [attemptA, attemptB],
    };
  }

  // Attempt A failed for non-auth reasons
  return {
    error: attemptA.error || 'Geoclient request failed',
    attempts: [attemptA],
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const searchType = params.get('type');

    if (!GEOCLIENT_APP_KEY) {
      console.error('Missing GEOCLIENT_APP_KEY');
      return new Response(
        JSON.stringify({ error: 'Geoclient API not configured', details: 'Missing API key' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let propertyInfo: PropertyInfo;

    if (searchType === 'address') {
      const houseNumber = params.get('house');
      const street = params.get('street');
      const borough = params.get('borough');

      if (!houseNumber || !street || !borough) {
        return new Response(
          JSON.stringify({ error: 'house, street, and borough are required for address search' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const titleCaseBorough = toTitleCase(borough);
      const normalizedBorough = BOROUGH_NAMES[borough.toUpperCase()] || titleCaseBorough;

      console.log(`Geocoding address: ${houseNumber} ${street}, ${titleCaseBorough}`);

      const result = await geoclientFetch('address.json', {
        houseNumber,
        street,
        borough: titleCaseBorough,
      });

      if ('error' in result) {
        console.error('Geoclient failed:', result.error);
        return new Response(
          JSON.stringify({ 
            error: 'Failed to geocode address',
            details: result.error,
            attempts: result.attempts.map(a => ({
              attempt: a.attempt,
              status: a.status,
              hasAppId: !!GEOCLIENT_APP_ID,
              hasAppKey: !!GEOCLIENT_APP_KEY,
            })),
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Geoclient response (attempt ${result.attemptUsed}):`, JSON.stringify(result.data, null, 2));

      const address = result.data.address;
      if (!address) {
        return new Response(
          JSON.stringify({ error: 'No address data returned from Geoclient' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check for errors
      if (address.returnCode1a && address.returnCode1a !== '00' && address.returnCode1a !== '01') {
        return new Response(
          JSON.stringify({ 
            error: 'Address not found',
            details: address.message || `Return code: ${address.returnCode1a}`
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Extract BBL components
      const bbl = address.bbl || '';
      const boroughCode = address.bblBoroughCode || bbl.charAt(0) || BOROUGH_CODES[normalizedBorough.toUpperCase()] || '1';
      const block = address.bblTaxBlock || bbl.slice(1, 6) || '00000';
      const lot = address.bblTaxLot || bbl.slice(6, 10) || '0000';
      
      propertyInfo = {
        address: `${address.houseNumber || houseNumber} ${address.firstStreetNameNormalized || street}`.toUpperCase(),
        borough: BOROUGH_NAMES[boroughCode] || normalizedBorough,
        block: block.padStart(5, '0'),
        lot: lot.padStart(4, '0'),
        bbl: bbl || `${boroughCode}${block.padStart(5, '0')}${lot.padStart(4, '0')}`,
        bin: address.buildingIdentificationNumber,
        latitude: address.latitude,
        longitude: address.longitude,
      };

    } else if (searchType === 'bbl') {
      const boroughCode = params.get('borough') || '1';
      const block = params.get('block') || '00001';
      const lot = params.get('lot') || '0001';

      // Validate inputs
      if (!/^\d{1,5}$/.test(block) || !/^\d{1,4}$/.test(lot)) {
        return new Response(
          JSON.stringify({ error: 'Invalid block or lot format' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const normalizedBlock = block.padStart(5, '0');
      const normalizedLot = lot.padStart(4, '0');
      const bbl = `${boroughCode}${normalizedBlock}${normalizedLot}`;

      console.log(`BBL search: ${bbl}`);

      // For BBL search, we can optionally call Geoclient to get address info
      propertyInfo = {
        address: `BLOCK ${normalizedBlock}, LOT ${normalizedLot}`,
        borough: BOROUGH_NAMES[boroughCode] || 'Manhattan',
        block: normalizedBlock,
        lot: normalizedLot,
        bbl: bbl,
      };

      // Optionally call Geoclient BBL endpoint
      try {
        const result = await geoclientFetch('bbl.json', {
          borough: boroughCode,
          block,
          lot,
        });

        if (!('error' in result) && result.data.bbl) {
          const bblData = result.data.bbl;
          propertyInfo.address = bblData.giHighHouseNumber1 && bblData.giStreetName1 
            ? `${bblData.giHighHouseNumber1} ${bblData.giStreetName1}`.toUpperCase()
            : propertyInfo.address;
          propertyInfo.bin = bblData.buildingIdentificationNumber || propertyInfo.bin;
          propertyInfo.latitude = bblData.latitude;
          propertyInfo.longitude = bblData.longitude;
        }
      } catch (bblError) {
        console.log('BBL geoclient lookup failed, using basic info:', bblError);
      }

    } else {
      return new Response(
        JSON.stringify({ error: 'Invalid search type. Use "address" or "bbl"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Returning property info:', JSON.stringify(propertyInfo));

    return new Response(JSON.stringify(propertyInfo), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in geocode function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
