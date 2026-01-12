import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ Inline Shared Utilities ============
function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
}

interface RequestContext { requestId: string; endpoint: string; startTime: number; }

function createRequestContext(endpoint: string): RequestContext {
  return { requestId: generateRequestId(), endpoint, startTime: Date.now() };
}

function logRequest(ctx: RequestContext, message: string, extra?: Record<string, unknown>) {
  console.log(JSON.stringify({ requestId: ctx.requestId, endpoint: ctx.endpoint, durationMs: Date.now() - ctx.startTime, message, ...extra }));
}

interface StandardError { error: string; details: string; userMessage: string; requestId: string; upstream?: { service: string; status: number }; }

function createErrorResponse(ctx: RequestContext, statusCode: number, error: string, details: string, userMessage: string, upstream?: { service: string; status: number }): Response {
  const body: StandardError = { error, details, userMessage, requestId: ctx.requestId, ...(upstream && { upstream }) };
  logRequest(ctx, `Error: ${error}`, { statusCode, upstreamStatus: upstream?.status });
  return new Response(JSON.stringify(body), { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now(); const entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart >= 60000) { rateLimitStore.set(ip, { count: 1, windowStart: now }); return { allowed: true }; }
  if (entry.count >= 30) { return { allowed: false, retryAfter: Math.ceil((entry.windowStart + 60000 - now) / 1000) }; }
  entry.count++; return { allowed: true };
}

function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

// Geoclient cache (24 hours for address lookups)
const geoclientCache = new Map<string, { data: unknown; expiresAt: number }>();
const GEOCLIENT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getGeoclientCached<T>(key: string): T | null {
  const entry = geoclientCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) { if (entry) geoclientCache.delete(key); return null; }
  return entry.data as T;
}

function setGeoclientCache<T>(key: string, data: T): void {
  geoclientCache.set(key, { data, expiresAt: Date.now() + GEOCLIENT_CACHE_TTL });
  // Limit cache size
  if (geoclientCache.size > 500) {
    const oldest = geoclientCache.keys().next().value;
    if (oldest) geoclientCache.delete(oldest);
  }
}
// ============ End Shared Utilities ============

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

// Suffix fallback list for single-token street names
const SUFFIX_FALLBACK_LIST = ['St', 'Ave', 'Rd', 'Blvd', 'Pl', 'Dr', 'Ct', 'Ln', 'Pkwy', 'Way'];

// Check if a street name is a single token (no spaces, no known suffix)
function isSingleTokenStreet(street: string): boolean {
  const trimmed = street.trim();
  if (trimmed.includes(' ')) return false;
  
  // Check if it ends with a known suffix
  const lowerStreet = trimmed.toLowerCase();
  const knownSuffixes = Object.keys(STREET_SUFFIX_MAP);
  for (const suffix of knownSuffixes) {
    if (lowerStreet.endsWith(suffix)) return false;
  }
  
  return true;
}

// Main geocode function with retry logic for street normalization
async function geocodeAddress(
  houseNumber: string,
  street: string,
  borough: string
): Promise<{ 
  success: true; 
  data: GeoclientResponse; 
  streetUsed: string 
} | { 
  success: false; 
  error: string; 
  details: string; 
  upstreamMessage?: string;
  normalizedStreetTried?: string; 
  attemptedStreets?: string[]; 
  userMessage?: string 
}> {
  
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

  // Capture upstream message for suggestion parsing
  const upstreamMessage = data1.address?.message || '';
  console.log(`Geoclient upstream message: "${upstreamMessage}"`);

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
    return {
      success: false,
      error: 'Address not found',
      details: upstreamMessage || 'Street not recognized',
      upstreamMessage,
      normalizedStreetTried: suffixNormalized,
      userMessage: "Street name not recognized—check spelling or try a different borough.",
    };
  }

  // Original attempt failed without suffix to normalize
  return {
    success: false,
    error: 'Address not found',
    details: upstreamMessage || 'Address not found',
    upstreamMessage,
    userMessage: isNotRecognizedError(data1) 
      ? "Street name not recognized—check spelling or try a different borough."
      : undefined,
  };
}

// Parse suggestions from Geoclient error messages like "IS IT 'TEHAMA STREET'?"
interface StreetSuggestion {
  streetName: string;
  streetType?: string;
  borough?: string;
  label: string; // Display label for the chip
}

function parseSuggestionsFromMessage(message: string, borough: string): StreetSuggestion[] {
  const suggestions: StreetSuggestion[] = [];
  const upperMessage = message.toUpperCase();
  
  // Pattern: "IS IT 'TEHAMA STREET'?" or "DID YOU MEAN 'TEHAMA ST'?"
  // Also handle without quotes: "IS IT TEHAMA STREET?"
  const suggestionPatterns = [
    /IS IT ['"]([^'"]+)['"][\s?]*/gi,
    /DID YOU MEAN ['"]([^'"]+)['"][\s?]*/gi,
    /SIMILAR TO ['"]([^'"]+)['"][\s?]*/gi,
    /IS IT\s+([A-Z0-9][A-Z0-9\s]+(?:STREET|ST|AVENUE|AVE|ROAD|RD|BOULEVARD|BLVD|PLACE|PL|DRIVE|DR|COURT|CT|LANE|LN|TERRACE|TER|PARKWAY|PKWY|WAY|HIGHWAY|HWY))\s*\?/gi,
  ];
  
  for (const pattern of suggestionPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const suggested = match[1].trim();
      if (suggested && suggested.length > 1) {
        // Try to extract street type from suggestion
        const words = suggested.split(/\s+/);
        if (words.length >= 2) {
          const lastWord = words[words.length - 1].toUpperCase();
          const suffixAbbrev = STREET_SUFFIX_MAP[lastWord.toLowerCase()];
          if (suffixAbbrev) {
            const streetName = words.slice(0, -1).join(' ');
            const streetType = suffixAbbrev.charAt(0).toUpperCase() + suffixAbbrev.slice(1);
            suggestions.push({
              streetName: streetName,
              streetType: streetType,
              borough: BOROUGH_NAMES[borough.toUpperCase()] || borough,
              label: `${streetName} ${streetType}`,
            });
          } else {
            // Check if last word IS a known suffix abbreviation (ST, AVE, etc.)
            const knownAbbrevs: Record<string, string> = {
              'ST': 'St', 'AVE': 'Ave', 'RD': 'Rd', 'BLVD': 'Blvd',
              'PL': 'Pl', 'DR': 'Dr', 'CT': 'Ct', 'LN': 'Ln',
              'TER': 'Ter', 'PKWY': 'Pkwy', 'HWY': 'Hwy'
            };
            if (knownAbbrevs[lastWord]) {
              const streetName = words.slice(0, -1).join(' ');
              suggestions.push({
                streetName: streetName,
                streetType: knownAbbrevs[lastWord],
                borough: BOROUGH_NAMES[borough.toUpperCase()] || borough,
                label: `${streetName} ${knownAbbrevs[lastWord]}`,
              });
            } else {
              suggestions.push({
                streetName: suggested,
                borough: BOROUGH_NAMES[borough.toUpperCase()] || borough,
                label: suggested,
              });
            }
          }
        } else {
          suggestions.push({
            streetName: suggested,
            borough: BOROUGH_NAMES[borough.toUpperCase()] || borough,
            label: suggested,
          });
        }
      }
    }
  }
  
  // Deduplicate by label
  const seen = new Set<string>();
  return suggestions.filter(s => {
    const key = s.label.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Geocode with suffix fallback for single-token streets
async function geocodeWithFallback(
  houseNumber: string,
  streetName: string,
  streetType: string,
  borough: string
): Promise<{ 
  success: true; 
  data: GeoclientResponse; 
  streetUsed: string;
  usedFallback: boolean;
} | { 
  success: false; 
  error: string; 
  details: string; 
  attemptedStreets?: string[]; 
  userMessage?: string;
  suggestions?: StreetSuggestion[];
  upstreamMessage?: string;
}> {
  
  // If streetType is provided and not empty, use it directly
  if (streetType && streetType.trim() !== '') {
    const constructedStreet = `${streetName} ${streetType}`;
    const result = await geocodeAddress(houseNumber, constructedStreet, borough);
    if (result.success) {
      return { ...result, usedFallback: false };
    }
    
    // Parse suggestions from upstream message if available
    const upstreamMsg = 'upstreamMessage' in result ? result.upstreamMessage : result.details;
    const suggestions = upstreamMsg ? parseSuggestionsFromMessage(upstreamMsg, borough) : [];
    
    return {
      ...result,
      upstreamMessage: upstreamMsg,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }
  
  // streetType is empty or not provided
  // First, try streetName as-is (handles "Broadway", "Park Avenue South", etc.)
  console.log(`Trying street as-is: "${streetName}"`);
  const directResult = await geocodeAddress(houseNumber, streetName, borough);
  if (directResult.success) {
    return { ...directResult, usedFallback: false };
  }
  
  // Capture upstream message from initial attempt
  const upstreamMsg = 'upstreamMessage' in directResult ? directResult.upstreamMessage : directResult.details;
  
  // If direct attempt failed and it's a single-token street, try suffix fallback
  if (!isSingleTokenStreet(streetName)) {
    // Multi-token street that failed - return the original error with suggestions
    const suggestions = upstreamMsg ? parseSuggestionsFromMessage(upstreamMsg, borough) : [];
    
    return {
      ...directResult,
      upstreamMessage: upstreamMsg,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
    };
  }
  
  // Single-token street name without suffix - try suffix fallback
  console.log(`Single-token street "${streetName}" failed, trying suffix fallback`);
  const attemptedStreets: string[] = [streetName];
  let lastUpstreamMessage = upstreamMsg || '';
  
  for (const suffix of SUFFIX_FALLBACK_LIST) {
    const constructedStreet = `${streetName} ${suffix}`;
    attemptedStreets.push(constructedStreet);
    console.log(`Fallback attempt: ${constructedStreet}`);
    
    const result = await geoclientFetch('address.json', {
      houseNumber,
      street: constructedStreet,
      borough,
    });
    
    if (!('error' in result)) {
      // Capture the upstream message from this attempt
      if (result.data.address?.message) {
        lastUpstreamMessage = result.data.address.message;
      }
      
      if (!isNotRecognizedError(result.data)) {
        const returnCode = result.data.address?.returnCode1a;
        if (returnCode === '00' || returnCode === '01') {
          console.log(`Fallback succeeded with: ${constructedStreet}`);
          return { success: true, data: result.data, streetUsed: constructedStreet, usedFallback: true };
        }
      }
    }
  }
  
  // All fallback attempts failed - try to parse suggestions from any upstream messages
  console.log(`All fallback attempts failed for "${streetName}". Last upstream message: "${lastUpstreamMessage}"`);
  const suggestions = lastUpstreamMessage ? parseSuggestionsFromMessage(lastUpstreamMessage, borough) : [];
  
  return {
    success: false,
    error: 'Address not found',
    details: lastUpstreamMessage || `Street "${streetName}" not recognized with any common suffix`,
    attemptedStreets,
    upstreamMessage: lastUpstreamMessage,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
    userMessage: `Street name not recognized—check spelling or try a different borough.`,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ctx = createRequestContext('geocode');

  try {
    // Rate limiting
    const clientIP = getClientIP(req);
    const rateLimit = checkRateLimit(clientIP);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded',
        details: `Too many requests. Please wait ${rateLimit.retryAfter} seconds.`,
        userMessage: 'You\'re making too many requests. Please wait a moment and try again.',
        requestId: ctx.requestId,
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfter) },
      });
    }

    const url = new URL(req.url);
    const params = url.searchParams;
    const searchType = params.get('type');

    if (!GEOCLIENT_APP_KEY) {
      return createErrorResponse(ctx, 500, 'Configuration error', 'Geoclient API not configured', 'The geocoding service is not properly configured.');
    }

    let propertyInfo: PropertyInfo;

    if (searchType === 'address') {
      const houseNumber = (params.get('house') || '').trim();
      const streetName = (params.get('streetName') || '').trim();
      const streetType = (params.get('streetType') || '').trim();
      const borough = params.get('borough') || '';

      // Debug logging
      console.log(`Received params - house: "${houseNumber}", streetName: "${streetName}", streetType: "${streetType}", borough: "${borough}"`);

      if (!houseNumber || !streetName || !borough) {
        return new Response(
          JSON.stringify({ 
            error: 'house, streetName, and borough are required for address search',
            receivedHouseNumber: houseNumber,
            receivedStreetName: streetName,
            receivedStreetType: streetType,
            receivedBorough: borough,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const titleCaseBorough = toTitleCase(borough);
      const normalizedBorough = BOROUGH_NAMES[borough.toUpperCase()] || titleCaseBorough;

      // Use the new geocode function with suffix fallback
      const geocodeResult = await geocodeWithFallback(houseNumber, streetName, streetType, titleCaseBorough);

      if (!geocodeResult.success) {
        console.error('Geocode failed:', geocodeResult.error, geocodeResult.details);
        return new Response(
          JSON.stringify({ 
            error: geocodeResult.error,
            details: geocodeResult.details,
            attemptedStreets: geocodeResult.attemptedStreets,
            suggestions: geocodeResult.suggestions,
            userMessage: geocodeResult.userMessage || 'Street name not recognized—check spelling or try a different borough.',
            receivedHouseNumber: houseNumber,
            receivedStreetName: streetName,
            receivedStreetType: streetType,
            receivedBorough: borough,
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Geoclient succeeded with street: ${geocodeResult.streetUsed}${geocodeResult.usedFallback ? ' (via fallback)' : ''}`);

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
    const streetName = params.get('streetName') || '';
    const streetType = params.get('streetType') || '';
    const responseData = {
      ...propertyInfo,
      receivedHouseNumber: params.get('house') || '',
      receivedStreetName: streetName,
      receivedStreetType: streetType,
      constructedStreet: streetType && streetType !== 'None' ? `${streetName} ${streetType}` : streetName,
      receivedBorough: params.get('borough') || '',
    };

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return createErrorResponse(ctx, 500, 'Internal server error', 
      error instanceof Error ? error.message : 'Unknown error',
      'An unexpected error occurred. Please try again.');
  }
});
