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

// Street suffix normalization mapping
const STREET_SUFFIX_MAP: Record<string, string> = {
  'street': 'st',
  'avenue': 'ave',
  'boulevard': 'blvd',
  'road': 'rd',
  'place': 'pl',
  'drive': 'dr',
  'court': 'ct',
  'lane': 'ln',
  'terrace': 'ter',
  'parkway': 'pkwy',
  'highway': 'hwy',
};

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

// Normalize street input: trim, collapse spaces
function normalizeStreetInput(street: string): string {
  return street
    .trim()
    .replace(/\s+/g, ' '); // Collapse multiple spaces
}

// Normalize street suffix (Street -> St, Avenue -> Ave, etc.)
function normalizeStreetSuffix(street: string): { normalized: string; wasNormalized: boolean } {
  const words = street.split(' ');
  if (words.length === 0) {
    return { normalized: street, wasNormalized: false };
  }
  
  const lastWord = words[words.length - 1].toLowerCase();
  const abbreviation = STREET_SUFFIX_MAP[lastWord];
  
  if (abbreviation) {
    // Replace last word with abbreviation, preserving title case
    words[words.length - 1] = abbreviation.charAt(0).toUpperCase() + abbreviation.slice(1);
    return { normalized: words.join(' '), wasNormalized: true };
  }
  
  return { normalized: street, wasNormalized: false };
}

// Convert borough to Title Case for API
function toTitleCase(borough: string): string {
  const normalized = BOROUGH_NAMES[borough.toUpperCase()];
  return normalized || borough.charAt(0).toUpperCase() + borough.slice(1).toLowerCase();
}

// Check if the response indicates "NOT RECOGNIZED" error
function isNotRecognizedError(data: GeoclientResponse): boolean {
  const address = data.address;
  if (!address) return false;
  
  const message = (address.message || '').toUpperCase();
  const returnCode = address.returnCode1a || '';
  
  // Return codes that indicate street not recognized
  // Common codes: 11, 12, 13 for various "not recognized" scenarios
  return message.includes('NOT RECOGNIZED') || 
         message.includes('STREET NAME NOT FOUND') ||
         ['11', '12', '13', '42'].includes(returnCode);
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

  console.log(`Attempt A (API Gateway): street=${params.street}, borough=${params.borough}`);

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

  console.log(`Attempt B (Maps NYC): street=${params.street}, borough=${params.borough}`);

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

// Main geocode function with retry logic for street normalization
async function geocodeAddress(
  houseNumber: string,
  street: string,
  borough: string
): Promise<{ success: true; data: GeoclientResponse; streetUsed: string } | { success: false; error: string; details: string; normalizedStreetTried?: string; userMessage?: string }> {
  
  // First attempt with original street (after basic normalization)
  const normalizedStreet = normalizeStreetInput(street);
  console.log(`Geocoding: ${houseNumber} ${normalizedStreet}, ${borough}`);
  
  const result1 = await geoclientFetch('address.json', {
    houseNumber,
    street: normalizedStreet,
    borough,
  });

  if ('error' in result1) {
    return { success: false, error: 'Failed to geocode address', details: result1.error };
  }

  // Check if first attempt succeeded
  const data1 = result1.data;
  if (data1.address && !isNotRecognizedError(data1)) {
    const returnCode = data1.address.returnCode1a;
    if (returnCode === '00' || returnCode === '01') {
      return { success: true, data: data1, streetUsed: normalizedStreet };
    }
  }

  // If NOT RECOGNIZED, try with suffix-normalized street
  const { normalized: suffixNormalized, wasNormalized } = normalizeStreetSuffix(normalizedStreet);
  
  if (wasNormalized && suffixNormalized !== normalizedStreet) {
    console.log(`Retrying with normalized suffix: ${suffixNormalized}`);
    
    const result2 = await geoclientFetch('address.json', {
      houseNumber,
      street: suffixNormalized,
      borough,
    });

    if (!('error' in result2)) {
      const data2 = result2.data;
      if (data2.address && !isNotRecognizedError(data2)) {
        const returnCode = data2.address.returnCode1a;
        if (returnCode === '00' || returnCode === '01') {
          return { success: true, data: data2, streetUsed: suffixNormalized };
        }
      }
    }

    // Both attempts failed
    const message = data1.address?.message || 'Street not recognized';
    return {
      success: false,
      error: 'Address not found',
      details: message,
      normalizedStreetTried: suffixNormalized,
      userMessage: "Street name not recognized. Try using abbreviations like 'St', 'Ave', 'Blvd'.",
    };
  }

  // Original attempt failed without suffix to normalize
  const message = data1.address?.message || 'Address not found';
  return {
    success: false,
    error: 'Address not found',
    details: message,
    userMessage: isNotRecognizedError(data1) 
      ? "Street name not recognized. Check spelling or try abbreviations like 'St', 'Ave'."
      : undefined,
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
      const houseNumber = (params.get('house') || '').trim();
      const street = params.get('street') || '';
      const borough = params.get('borough') || '';

      // Debug logging
      console.log(`Received params - house: "${houseNumber}", street: "${street}", borough: "${borough}"`);

      if (!houseNumber || !street || !borough) {
        return new Response(
          JSON.stringify({ 
            error: 'house, street, and borough are required for address search',
            receivedHouse: houseNumber,
            receivedStreet: street,
            receivedBorough: borough,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const titleCaseBorough = toTitleCase(borough);
      const normalizedBorough = BOROUGH_NAMES[borough.toUpperCase()] || titleCaseBorough;

      // Use the new geocode function with retry logic
      const geocodeResult = await geocodeAddress(houseNumber, street, titleCaseBorough);

      if (!geocodeResult.success) {
        console.error('Geocode failed:', geocodeResult.error, geocodeResult.details);
        return new Response(
          JSON.stringify({ 
            error: geocodeResult.error,
            details: geocodeResult.details,
            normalizedStreetTried: geocodeResult.normalizedStreetTried,
            userMessage: geocodeResult.userMessage,
            receivedHouse: houseNumber,
            receivedStreet: street,
            receivedBorough: borough,
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Geoclient succeeded with street: ${geocodeResult.streetUsed}`);

      const address = geocodeResult.data.address!;

      // Extract BBL components
      const bbl = address.bbl || '';
      const boroughCode = address.bblBoroughCode || bbl.charAt(0) || BOROUGH_CODES[normalizedBorough.toUpperCase()] || '1';
      const block = address.bblTaxBlock || bbl.slice(1, 6) || '00000';
      const lot = address.bblTaxLot || bbl.slice(6, 10) || '0000';
      
      propertyInfo = {
        address: `${address.houseNumber || houseNumber} ${address.firstStreetNameNormalized || geocodeResult.streetUsed}`.toUpperCase(),
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

    // Add debug fields to success response
    const responseData = {
      ...propertyInfo,
      receivedHouse: params.get('house') || '',
      receivedStreet: params.get('street') || '',
      receivedBorough: params.get('borough') || '',
    };

    return new Response(JSON.stringify(responseData), {
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
