import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEOCLIENT_APP_ID = Deno.env.get('GEOCLIENT_APP_ID');
const GEOCLIENT_APP_KEY = Deno.env.get('GEOCLIENT_APP_KEY');
const GEOCLIENT_BASE_URL = 'https://api.nyc.gov/geo/geoclient/v1';

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
}

const BOROUGH_NAMES: Record<string, string> = {
  '1': 'MANHATTAN',
  '2': 'BRONX', 
  '3': 'BROOKLYN',
  '4': 'QUEENS',
  '5': 'STATEN ISLAND',
  'MANHATTAN': 'MANHATTAN',
  'BRONX': 'BRONX',
  'BROOKLYN': 'BROOKLYN',
  'QUEENS': 'QUEENS',
  'STATEN ISLAND': 'STATEN ISLAND',
  'MN': 'MANHATTAN',
  'BX': 'BRONX',
  'BK': 'BROOKLYN',
  'QN': 'QUEENS',
  'SI': 'STATEN ISLAND',
};

const BOROUGH_CODES: Record<string, string> = {
  'MANHATTAN': '1',
  'BRONX': '2',
  'BROOKLYN': '3',
  'QUEENS': '4',
  'STATEN ISLAND': '5',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const searchType = params.get('type');

    if (!GEOCLIENT_APP_ID || !GEOCLIENT_APP_KEY) {
      console.error('Missing Geoclient credentials');
      return new Response(
        JSON.stringify({ error: 'Geoclient API not configured' }),
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

      const normalizedBorough = BOROUGH_NAMES[borough.toUpperCase()] || borough.toUpperCase();

      console.log(`Geocoding address: ${houseNumber} ${street}, ${normalizedBorough}`);

      // Call Geoclient API
      const geoclientUrl = new URL(`${GEOCLIENT_BASE_URL}/address.json`);
      geoclientUrl.searchParams.set('houseNumber', houseNumber);
      geoclientUrl.searchParams.set('street', street);
      geoclientUrl.searchParams.set('borough', normalizedBorough);
      geoclientUrl.searchParams.set('app_id', GEOCLIENT_APP_ID);
      geoclientUrl.searchParams.set('app_key', GEOCLIENT_APP_KEY);

      console.log(`Calling Geoclient: ${geoclientUrl.toString().replace(GEOCLIENT_APP_KEY, '[REDACTED]')}`);

      const geoclientResponse = await fetch(geoclientUrl.toString());
      
      if (!geoclientResponse.ok) {
        const errorText = await geoclientResponse.text();
        console.error(`Geoclient API error: ${geoclientResponse.status} - ${errorText}`);
        return new Response(
          JSON.stringify({ 
            error: 'Failed to geocode address',
            details: geoclientResponse.status === 401 ? 'Invalid API credentials' : errorText
          }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const geoclientData: GeoclientResponse = await geoclientResponse.json();
      console.log('Geoclient response:', JSON.stringify(geoclientData, null, 2));

      const address = geoclientData.address;
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
      const boroughCode = address.bblBoroughCode || bbl.charAt(0) || BOROUGH_CODES[normalizedBorough] || '1';
      const block = address.bblTaxBlock || bbl.slice(1, 6) || '00000';
      const lot = address.bblTaxLot || bbl.slice(6, 10) || '0000';
      
      propertyInfo = {
        address: `${address.houseNumber || houseNumber} ${address.firstStreetNameNormalized || street}`.toUpperCase(),
        borough: BOROUGH_NAMES[boroughCode] || normalizedBorough,
        block: block.padStart(5, '0'),
        lot: lot.padStart(4, '0'),
        bbl: bbl || `${boroughCode}${block.padStart(5, '0')}${lot.padStart(4, '0')}`,
        bin: address.buildingIdentificationNumber,
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
      // but for now, just return the BBL info
      propertyInfo = {
        address: `BLOCK ${normalizedBlock}, LOT ${normalizedLot}`,
        borough: BOROUGH_NAMES[boroughCode] || 'MANHATTAN',
        block: normalizedBlock,
        lot: normalizedLot,
        bbl: bbl,
      };

      // Optionally call Geoclient BBL endpoint
      try {
        const geoclientUrl = new URL(`${GEOCLIENT_BASE_URL}/bbl.json`);
        geoclientUrl.searchParams.set('borough', boroughCode);
        geoclientUrl.searchParams.set('block', block);
        geoclientUrl.searchParams.set('lot', lot);
        geoclientUrl.searchParams.set('app_id', GEOCLIENT_APP_ID);
        geoclientUrl.searchParams.set('app_key', GEOCLIENT_APP_KEY);

        const geoclientResponse = await fetch(geoclientUrl.toString());
        if (geoclientResponse.ok) {
          const geoclientData = await geoclientResponse.json();
          if (geoclientData.bbl) {
            const bblData = geoclientData.bbl;
            propertyInfo.address = bblData.giHighHouseNumber1 && bblData.giStreetName1 
              ? `${bblData.giHighHouseNumber1} ${bblData.giStreetName1}`.toUpperCase()
              : propertyInfo.address;
            propertyInfo.bin = bblData.buildingIdentificationNumber || propertyInfo.bin;
          }
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
