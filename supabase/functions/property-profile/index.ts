import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLUTO_DATASET_ID = '64uk-42ks';
const PLUTO_BASE_URL = `https://data.cityofnewyork.us/resource/${PLUTO_DATASET_ID}.json`;

// ============ Schema Guard ============

const CANDIDATE_COLUMNS = {
  bbl: ['bbl'],
  borough: ['borough', 'boro', 'borocode'],
  block: ['block'],
  lot: ['lot'],
  landUse: ['landuse', 'land_use'],
  buildingClass: ['bldgclass', 'building_class', 'buildingclass'],
  unitsRes: ['unitsres', 'units_res', 'residentialunits', 'residential_units'],
  unitsTotal: ['unitstotal', 'units_total', 'totalunits', 'total_units'],
  yearBuilt: ['yearbuilt', 'year_built', 'yrbuilt'],
  grossSqFt: ['bldgarea', 'building_area', 'grosssqft', 'gross_sqft', 'grossarea'],
  lotArea: ['lotarea', 'lot_area', 'landarea'],
  condoNo: ['condono', 'condo_no', 'condonumber'],
  address: ['address', 'addr'],
  ownerName: ['ownername', 'owner_name'],
  numFloors: ['numfloors', 'num_floors', 'floors'],
  zipCode: ['zipcode', 'zip_code', 'zip'],
};

const MINIMAL_SAFE_COLUMNS = ['bbl'];

const schemaCache = new Map<string, { columns: Set<string>; expiresAt: number }>();
const SCHEMA_CACHE_TTL = 24 * 60 * 60 * 1000;

interface SchemaInfo {
  columns: Set<string>;
  columnMap: Record<string, string | null>;
}

async function discoverSchema(appToken: string): Promise<SchemaInfo> {
  const cacheKey = `schema:${PLUTO_DATASET_ID}`;
  const cached = schemaCache.get(cacheKey);
  
  if (cached && cached.expiresAt > Date.now()) {
    return buildSchemaInfo(cached.columns);
  }

  try {
    const probeUrl = new URL(PLUTO_BASE_URL);
    probeUrl.searchParams.set('$limit', '1');
    
    const response = await fetch(probeUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-App-Token': appToken,
      },
    });

    if (!response.ok) {
      console.log(`Schema discovery failed with status ${response.status}`);
      return buildSchemaInfo(new Set(MINIMAL_SAFE_COLUMNS));
    }

    const data = await response.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      return buildSchemaInfo(new Set(MINIMAL_SAFE_COLUMNS));
    }

    const columns = new Set<string>(Object.keys(data[0]).map(k => k.toLowerCase()));
    schemaCache.set(cacheKey, { columns, expiresAt: Date.now() + SCHEMA_CACHE_TTL });
    
    return buildSchemaInfo(columns);
  } catch (error) {
    console.error('Schema discovery error:', error);
    return buildSchemaInfo(new Set(MINIMAL_SAFE_COLUMNS));
  }
}

function buildSchemaInfo(columns: Set<string>): SchemaInfo {
  const findFirst = (candidates: string[]): string | null => {
    for (const col of candidates) {
      if (columns.has(col)) return col;
    }
    return null;
  };

  const columnMap: Record<string, string | null> = {};
  for (const [key, candidates] of Object.entries(CANDIDATE_COLUMNS)) {
    columnMap[key] = findFirst(candidates);
  }

  return { columns, columnMap };
}

// ============ Shared Utilities ============

function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

interface RequestContext {
  requestId: string;
  endpoint: string;
  bbl?: string;
  startTime: number;
}

function createRequestContext(endpoint: string, bbl?: string): RequestContext {
  return { requestId: generateRequestId(), endpoint, bbl, startTime: Date.now() };
}

function logRequest(ctx: RequestContext, message: string, extra?: Record<string, unknown>) {
  const duration = Date.now() - ctx.startTime;
  console.log(JSON.stringify({ requestId: ctx.requestId, endpoint: ctx.endpoint, bbl: ctx.bbl, durationMs: duration, message, ...extra }));
}

interface StandardError {
  error: string;
  details: string;
  userMessage: string;
  requestId: string;
  upstream?: { service: string; status: number };
}

function createErrorResponse(ctx: RequestContext, statusCode: number, error: string, details: string, userMessage: string, upstream?: { service: string; status: number }): Response {
  const body: StandardError = { error, details, userMessage, requestId: ctx.requestId, ...(upstream && { upstream }) };
  logRequest(ctx, `Error: ${error}`, { statusCode, upstreamStatus: upstream?.status });
  return new Response(JSON.stringify(body), { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
function checkRateLimit(ip: string, maxRequests = 30, windowMs = 60000): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart >= windowMs) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((entry.windowStart + windowMs - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}

function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

const responseCache = new Map<string, { data: unknown; expiresAt: number }>();
const RESPONSE_CACHE_TTL = 60 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) responseCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  responseCache.set(key, { data, expiresAt: Date.now() + RESPONSE_CACHE_TTL });
}

async function fetchWithRetry(url: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return { ok: true, status: response.status, data: await response.json() };
      }
      if (response.status >= 500 && attempt < 1) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }
      return { ok: false, status: response.status, error: await response.text() };
    } catch (error) {
      if (attempt < 1) {
        await new Promise(r => setTimeout(r, 250));
        continue;
      }
      return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, status: 0, error: 'All retry attempts failed' };
}

// ============ Property Type Classification ============

type PropertyTypeLabel = 'Condo' | 'Co-op' | '1-2 Family' | '3+ Family' | 'Mixed-Use' | 'Commercial' | 'Other' | 'Unknown';
type PropertyTenure = 'CONDO' | 'COOP' | 'RENTAL_OR_OTHER' | 'UNKNOWN';

// Two-layer ownership types
type MunicipalOwnershipLabel = 'Condominium' | 'Ownership type not specified in municipal data';
type OwnershipConfidenceLevel = 'Confirmed' | 'Likely' | 'Unverified';
type OwnershipStructureType = 'Condominium' | 'Cooperative' | 'Rental' | 'Owner-Occupied' | 'Unknown';

const CONDO_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'RR', 'RS'];
const ONE_TWO_FAMILY_CLASSES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'B1', 'B2', 'B3', 'B9'];
const MIXED_USE_LAND_USES = ['04'];
const COMMERCIAL_LAND_USES = ['05', '06', '07', '08', '09', '10', '11'];

interface PropertyClassification {
  propertyTypeLabel: PropertyTypeLabel;
  propertyTenure: PropertyTenure;
}

// Layer 1: Municipal Classification
interface MunicipalClassification {
  label: MunicipalOwnershipLabel;
  evidence: string[];
  source: string;
}

// Layer 2: Ownership Structure
interface OwnershipStructure {
  type: OwnershipStructureType;
  confidence: OwnershipConfidenceLevel;
  evidence: string[];
  sources: string[];
}

// Combined profile
interface OwnershipProfile {
  municipal: MunicipalClassification;
  ownership: OwnershipStructure;
  warnings: string[];
}

/**
 * SECTION A: Municipal Classification
 * 
 * STRICT RULES:
 * - Do NOT use building class codes (e.g., C0, D4, R0-R9) to infer ownership
 * - Do NOT use "CO" strings or certificate-of-occupancy references
 * - Do NOT use unit count, BBL patterns, or anything heuristic
 * - Only show "Condominium" if an NYC dataset EXPLICITLY indicates it (e.g., condoNo field)
 */
function computeMunicipalClassification(
  buildingClass: string | null,
  condoNo: string | number | null,
  landUse: string | null,
  residentialUnits: number | null
): MunicipalClassification {
  const bc = (buildingClass || '').toUpperCase().trim();
  const evidence: string[] = [];

  // ONLY explicit condo indicator: condoNo field is set
  // Per strict rules: Do NOT use building class codes to infer condo/co-op
  const hasExplicitCondoNo = condoNo !== null && condoNo !== undefined && 
    String(condoNo).trim() !== '' && String(condoNo) !== '0';

  if (hasExplicitCondoNo) {
    evidence.push(`Condo Number: ${condoNo} (explicit municipal indicator)`);
    
    return {
      label: 'Condominium',
      evidence,
      source: 'NYC DOF (Department of Finance)',
    };
  }

  // Default: not specified in municipal data
  // Include available data for transparency but do NOT use for inference
  if (bc) evidence.push(`Building Class: ${bc} (not used for ownership inference)`);
  if (landUse) evidence.push(`Land Use: ${landUse}`);
  if (residentialUnits) evidence.push(`Residential Units: ${residentialUnits}`);

  return {
    label: 'Ownership type not specified in municipal data',
    evidence: evidence.length > 0 ? evidence : ['No explicit ownership indicators in municipal data'],
    source: 'NYC PLUTO/DOB',
  };
}

/**
 * SECTION B: Ownership Structure (External / Verification)
 * 
 * STRICT RULES:
 * - Only use external sources: ACRIS, offering plans, sales records, corporate filings
 * - Never infer co-op from DOB, PLUTO, CO status, building class, or any municipal-only fields
 * - If no external evidence, show "Unverified"
 */
function computeOwnershipStructure(
  municipal: MunicipalClassification
): OwnershipStructure {
  // If municipal explicitly says Condominium (via condoNo), that's confirmed
  if (municipal.label === 'Condominium') {
    return {
      type: 'Condominium',
      confidence: 'Confirmed',
      evidence: ['Condo number registered with NYC Department of Finance'],
      sources: ['NYC DOF'],
    };
  }

  // No external indicators available in this endpoint yet
  // (ACRIS, offering plans, sales records would be checked here when integrated)
  return {
    type: 'Unknown',
    confidence: 'Unverified',
    evidence: [],
    sources: [],
  };
}

/**
 * Computes complete two-layer ownership profile.
 */
function computeOwnershipProfile(
  buildingClass: string | null,
  condoNo: string | number | null,
  landUse: string | null,
  residentialUnits: number | null,
  bbl: string
): OwnershipProfile {
  const municipal = computeMunicipalClassification(
    buildingClass, condoNo, landUse, residentialUnits
  );
  const ownership = computeOwnershipStructure(municipal);

  const warnings: string[] = [];

  if (ownership.confidence === 'Unverified') {
    warnings.push(
      'DOB and PLUTO data do not reliably indicate cooperative ownership.'
    );
  }

  console.log(`[OwnershipClassifier] BBL ${bbl}:`, {
    municipal: municipal.label,
    ownership: `${ownership.type} (${ownership.confidence})`,
    condoNo,
    buildingClass,
  });

  return { municipal, ownership, warnings };
}

function classifyProperty(
  buildingClass: string | null,
  landUse: string | null,
  unitsRes: number | null,
  condoNo: string | number | null
): PropertyClassification {
  const bc = (buildingClass || '').toUpperCase().trim();
  const lu = (landUse || '').trim();

  if (CONDO_CLASSES.some(c => bc.startsWith(c))) {
    return { propertyTypeLabel: 'Condo', propertyTenure: 'CONDO' };
  }
  if (condoNo && String(condoNo).trim() !== '' && String(condoNo) !== '0') {
    return { propertyTypeLabel: 'Condo', propertyTenure: 'CONDO' };
  }

  if (COMMERCIAL_LAND_USES.includes(lu)) {
    return { propertyTypeLabel: 'Commercial', propertyTenure: 'RENTAL_OR_OTHER' };
  }

  if (MIXED_USE_LAND_USES.includes(lu)) {
    return { propertyTypeLabel: 'Mixed-Use', propertyTenure: 'RENTAL_OR_OTHER' };
  }

  if (ONE_TWO_FAMILY_CLASSES.some(c => bc.startsWith(c))) {
    return { propertyTypeLabel: '1-2 Family', propertyTenure: 'RENTAL_OR_OTHER' };
  }

  if (unitsRes !== null) {
    if (unitsRes <= 2) return { propertyTypeLabel: '1-2 Family', propertyTenure: 'RENTAL_OR_OTHER' };
    if (unitsRes >= 3) return { propertyTypeLabel: '3+ Family', propertyTenure: 'RENTAL_OR_OTHER' };
  }

  if (lu === '01') return { propertyTypeLabel: '1-2 Family', propertyTenure: 'RENTAL_OR_OTHER' };
  if (lu === '02' || lu === '03') return { propertyTypeLabel: '3+ Family', propertyTenure: 'RENTAL_OR_OTHER' };

  return { propertyTypeLabel: 'Unknown', propertyTenure: 'UNKNOWN' };
}

// ============ Profile Processing ============

interface PropertyProfile {
  bbl: string;
  borough: string | null;
  block: string | null;
  lot: string | null;
  address: string | null;
  landUse: string | null;
  buildingClass: string | null;
  propertyTypeLabel: PropertyTypeLabel;
  propertyTenure: PropertyTenure;
  // Two-layer ownership
  municipal: MunicipalClassification;
  ownership: OwnershipStructure;
  ownershipWarnings: string[];
  residentialUnits: number | null;
  totalUnits: number | null;
  yearBuilt: number | null;
  grossSqFt: number | null;
  lotArea: number | null;
  numFloors: number | null;
  zipCode: string | null;
  ownerName: string | null;
  source: {
    datasetId: string;
    fieldsUsed: string[];
  };
  raw: Record<string, unknown>;
  requestId: string;
}

function validateBBL(bbl: string): boolean {
  return /^\d{10}$/.test(bbl);
}

function getBoroughName(boroCode: string): string {
  const map: Record<string, string> = {
    '1': 'Manhattan',
    '2': 'Bronx',
    '3': 'Brooklyn',
    '4': 'Queens',
    '5': 'Staten Island',
  };
  return map[boroCode] || boroCode;
}

function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

function normalizeProfile(raw: Record<string, unknown>, bbl: string, schema: SchemaInfo, requestId: string): PropertyProfile {
  const getValue = (key: string): unknown => {
    const col = schema.columnMap[key];
    return col ? raw[col] : null;
  };

  const buildingClass = getValue('buildingClass') as string | null;
  const landUse = getValue('landUse') as string | null;
  const unitsRes = parseNumber(getValue('unitsRes'));
  const condoNoRaw = getValue('condoNo');
  const condoNo = condoNoRaw !== null && condoNoRaw !== undefined 
    ? (typeof condoNoRaw === 'string' || typeof condoNoRaw === 'number' ? condoNoRaw : null) 
    : null;

  const classification = classifyProperty(buildingClass, landUse, unitsRes, condoNo);
  const ownershipProfile = computeOwnershipProfile(
    buildingClass, condoNo, landUse, unitsRes, bbl
  );

  const fieldsUsed = Object.entries(schema.columnMap)
    .filter(([_, col]) => col !== null)
    .map(([_, col]) => col as string);

  return {
    bbl,
    borough: getBoroughName(bbl.charAt(0)),
    block: bbl.slice(1, 6).replace(/^0+/, '') || '0',
    lot: bbl.slice(6, 10).replace(/^0+/, '') || '0',
    address: getValue('address') as string | null,
    landUse,
    buildingClass,
    propertyTypeLabel: classification.propertyTypeLabel,
    propertyTenure: classification.propertyTenure,
    municipal: ownershipProfile.municipal,
    ownership: ownershipProfile.ownership,
    ownershipWarnings: ownershipProfile.warnings,
    residentialUnits: unitsRes,
    totalUnits: parseNumber(getValue('unitsTotal')),
    yearBuilt: parseNumber(getValue('yearBuilt')),
    grossSqFt: parseNumber(getValue('grossSqFt')),
    lotArea: parseNumber(getValue('lotArea')),
    numFloors: parseNumber(getValue('numFloors')),
    zipCode: getValue('zipCode') as string | null,
    ownerName: getValue('ownerName') as string | null,
    source: {
      datasetId: PLUTO_DATASET_ID,
      fieldsUsed,
    },
    raw,
    requestId,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ctx = createRequestContext('property-profile');
  const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

  try {
    if (!NYC_OPEN_DATA_APP_TOKEN) {
      return createErrorResponse(ctx, 500, 'Configuration error', 'NYC_OPEN_DATA_APP_TOKEN is not configured', 
        'Server is missing NYC Open Data token configuration.');
    }

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

    let bbl: string | null = null;
    for (const key of ['bbl', 'BBL']) {
      const v = params.get(key);
      if (v?.trim()) { bbl = v.trim(); break; }
    }

    if (!bbl) {
      return createErrorResponse(ctx, 400, 'Missing parameter', 'bbl parameter is required', 'Please provide a valid property identifier (BBL).');
    }

    bbl = bbl.padStart(10, '0');
    ctx.bbl = bbl;

    if (!validateBBL(bbl)) {
      return createErrorResponse(ctx, 400, 'Invalid BBL', 'bbl must be exactly 10 digits', 'The property identifier (BBL) format is invalid.');
    }

    const cacheKey = `property-profile:${bbl}`;
    const cached = getCached<PropertyProfile>(cacheKey);
    if (cached) {
      logRequest(ctx, 'Cache hit');
      return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const schema = await discoverSchema(NYC_OPEN_DATA_APP_TOKEN);
    
    if (!schema.columnMap.bbl) {
      return createErrorResponse(ctx, 400, 'Schema mismatch', 'PLUTO dataset does not have a bbl column',
        'Unable to query property profile—schema mismatch.');
    }

    const dataUrl = new URL(PLUTO_BASE_URL);
    dataUrl.searchParams.set('$where', `${schema.columnMap.bbl}='${bbl}'`);
    dataUrl.searchParams.set('$limit', '1');

    const headers: Record<string, string> = { 
      'Accept': 'application/json',
      'X-App-Token': NYC_OPEN_DATA_APP_TOKEN,
    };

    const result = await fetchWithRetry(dataUrl.toString(), { headers });

    if (!result.ok) {
      if (result.status === 400) {
        return createErrorResponse(ctx, 400, 'Invalid query', result.error || 'Upstream returned 400',
          'Invalid query—schema mismatch prevented.', { service: 'NYC Open Data', status: 400 });
      }
      if (result.status === 429) {
        return createErrorResponse(ctx, 429, 'Rate limited', 'Upstream rate limited',
          'NYC data service is busy.', { service: 'NYC Open Data', status: 429 });
      }
      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown error',
        'Unable to retrieve property profile.', { service: 'NYC Open Data', status: result.status });
    }

    const rawData = result.data as Record<string, unknown>[];
    
    if (rawData.length === 0) {
      const emptyProfile: PropertyProfile = {
        bbl,
        borough: getBoroughName(bbl.charAt(0)),
        block: bbl.slice(1, 6).replace(/^0+/, '') || '0',
        lot: bbl.slice(6, 10).replace(/^0+/, '') || '0',
        address: null,
        landUse: null,
        buildingClass: null,
        propertyTypeLabel: 'Unknown',
        propertyTenure: 'UNKNOWN',
        municipal: {
          label: 'Ownership type not specified in municipal data',
          evidence: ['No property data available'],
          source: 'NYC PLUTO',
        },
        ownership: {
          type: 'Unknown',
          confidence: 'Unverified',
          evidence: ['No external ownership records available'],
          sources: [],
        },
        ownershipWarnings: ['DOB and PLUTO data do not reliably indicate cooperative ownership.'],
        residentialUnits: null,
        totalUnits: null,
        yearBuilt: null,
        grossSqFt: null,
        lotArea: null,
        numFloors: null,
        zipCode: null,
        ownerName: null,
        source: { datasetId: PLUTO_DATASET_ID, fieldsUsed: [] },
        raw: {},
        requestId: ctx.requestId,
      };

      logRequest(ctx, 'No profile found', { bbl });
      return new Response(JSON.stringify(emptyProfile), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const profile = normalizeProfile(rawData[0], bbl, schema, ctx.requestId);
    setCache(cacheKey, profile);
    
    logRequest(ctx, 'Success', { 
      propertyType: profile.propertyTypeLabel,
      municipalLabel: profile.municipal.label,
      ownershipType: profile.ownership.type,
      ownershipConfidence: profile.ownership.confidence,
    });

    return new Response(JSON.stringify(profile), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return createErrorResponse(ctx, 500, 'Internal server error', 
      error instanceof Error ? error.message : 'Unknown error',
      'An unexpected error occurred.');
  }
});
