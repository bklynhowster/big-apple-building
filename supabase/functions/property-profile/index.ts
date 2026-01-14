import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data PLUTO (Primary Land Use Tax Lot Output) dataset
// This is the canonical source for property characteristics
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
    console.log(`PLUTO schema discovered: ${Array.from(columns).slice(0, 25).join(', ')}...`);
    
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
const RESPONSE_CACHE_TTL = 60 * 60 * 1000; // 1 hour for property profiles (rarely change)

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
type OwnershipConfidence = 'high' | 'medium' | 'low';
type OwnershipLabel = 
  | 'Condo'
  | 'Confirmed co-op'
  | 'Likely co-op'
  | 'Possible co-op (unconfirmed)'
  | 'Not a co-op'
  | 'Unknown / not specified';

// Building class codes reference: https://www.nyc.gov/assets/finance/jump/hlpbldgcode.html
const CONDO_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'RR', 'RS'];
const ONE_TWO_FAMILY_CLASSES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'B1', 'B2', 'B3', 'B9'];
const MIXED_USE_LAND_USES = ['04']; // Mixed residential/commercial
const COMMERCIAL_LAND_USES = ['05', '06', '07', '08', '09', '10', '11'];
const RESIDENTIAL_LAND_USES = ['01', '02', '03', '04'];

// Known BBL overrides for ownership classification (admin corrections)
const OWNERSHIP_OVERRIDES: Record<string, { label: OwnershipLabel; confidence: OwnershipConfidence; score: number; evidence: string[] }> = {
  // Add known false positives here as needed
  // '3064110045': { label: 'Unknown / not specified', confidence: 'low', score: 0, evidence: ['Manual override: confirmed not a co-op'] },
};

interface PropertyClassification {
  propertyTypeLabel: PropertyTypeLabel;
  propertyTenure: PropertyTenure;
}

interface OwnershipProfile {
  ownershipTypeLabel: OwnershipLabel;
  ownershipConfidence: OwnershipConfidence;
  ownershipScore: number;
  ownershipEvidence: string[];
  ownershipWarnings: string[];
}

/**
 * Checks if text contains explicit co-op keywords (not just "CO-" prefix).
 * Only matches "COOPERATIVE", "CO-OP", "COOP" as distinct words.
 */
function hasExplicitCoopText(text: string | null | undefined): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  // Match explicit co-op terms, not just "CO-" prefix
  return /\bCOOPERATIVE\b/.test(upper) || 
         /\bCO-OP\b/.test(upper) || 
         /\bCOOP\b/.test(upper);
}

/**
 * Computes ownership profile with scoring system (0-100).
 * 
 * RULES:
 * - "Condo=NO" is NOT evidence of co-op
 * - Unit BBLs existence → Force Condo, NEVER co-op
 * - Explicit "Cooperative" or "Co-op" text → +80
 * - Residential >10 units + no unit BBLs → +20
 * 
 * LABEL MAPPING:
 * - Condo indicators → "Condo" (score=100)
 * - score >= 80 with explicit text → "Likely co-op"
 * - score 40-79 → "Possible co-op (unconfirmed)"
 * - else → "Unknown / not specified"
 */
function computeOwnershipProfile(
  buildingClass: string | null,
  condoNo: string | number | null,
  landUse: string | null,
  residentialUnits: number | null,
  bbl: string,
  hasMultipleUnitBBLs: boolean,
  unitBBLCount: number,
  rawData?: Record<string, unknown>
): OwnershipProfile {
  // Check for admin override first
  if (OWNERSHIP_OVERRIDES[bbl]) {
    const override = OWNERSHIP_OVERRIDES[bbl];
    console.log(`[OwnershipClassifier] BBL ${bbl}: Admin override applied`, override);
    return {
      ownershipTypeLabel: override.label,
      ownershipConfidence: override.confidence,
      ownershipScore: override.score,
      ownershipEvidence: override.evidence,
      ownershipWarnings: [],
    };
  }

  const bc = (buildingClass || '').toUpperCase().trim();
  const lu = (landUse || '').trim();
  const units = residentialUnits || 0;
  const evidence: string[] = [];
  const warnings: string[] = [];

  // ============ CONDO DETECTION (highest priority) ============
  const isCondoClass = CONDO_CLASSES.some(c => bc.startsWith(c));
  const hasCondoNo = condoNo !== null && condoNo !== undefined && 
    String(condoNo).trim() !== '' && String(condoNo) !== '0';

  // If we have unit BBLs, it's definitely a condo, NEVER a co-op
  if (hasMultipleUnitBBLs && unitBBLCount > 0) {
    evidence.push(`Multiple unit BBLs present (${unitBBLCount} units)`);
    if (isCondoClass) evidence.push(`Building Class: ${bc} (condo class)`);
    if (hasCondoNo) evidence.push(`Condo Number: ${condoNo}`);
    
    console.log(`[OwnershipClassifier] BBL ${bbl}: Condo detected via unit BBLs`, { 
      unitBBLCount, bc, condoNo 
    });
    
    return {
      ownershipTypeLabel: 'Condo',
      ownershipConfidence: 'high',
      ownershipScore: 100,
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // Condo via class or condo number
  if (isCondoClass || hasCondoNo) {
    if (isCondoClass) evidence.push(`Building Class: ${bc} (condo class)`);
    if (hasCondoNo) evidence.push(`Condo Number: ${condoNo}`);
    
    console.log(`[OwnershipClassifier] BBL ${bbl}: Condo detected via class/condoNo`, { 
      bc, condoNo 
    });
    
    return {
      ownershipTypeLabel: 'Condo',
      ownershipConfidence: 'high',
      ownershipScore: 100,
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // ============ CO-OP SCORING ============
  let score = 0;
  let hasExplicitCoopEvidence = false;

  // Check for explicit co-op text in raw data fields
  const textFieldsToCheck: string[] = [];
  if (bc) textFieldsToCheck.push(bc);
  
  // Check raw data for any field containing explicit co-op text
  if (rawData) {
    for (const [key, value] of Object.entries(rawData)) {
      if (typeof value === 'string') {
        textFieldsToCheck.push(value);
      }
    }
  }

  const explicitCoopField = textFieldsToCheck.find(text => hasExplicitCoopText(text));
  
  if (explicitCoopField) {
    // +80 for explicit co-op text
    score += 80;
    hasExplicitCoopEvidence = true;
    const truncated = explicitCoopField.length > 50 ? explicitCoopField.substring(0, 50) + '...' : explicitCoopField;
    evidence.push(`Explicit "Cooperative" or "Co-op" text found: "${truncated}"`);
    console.log(`[OwnershipClassifier] BBL ${bbl}: +80 for explicit co-op text`, { 
      text: explicitCoopField.substring(0, 100) 
    });
  }

  // +20 if residential with >10 units and NO unit BBLs
  const isResidential = RESIDENTIAL_LAND_USES.includes(lu);
  if (isResidential && units > 10 && !hasMultipleUnitBBLs) {
    score += 20;
    evidence.push(`Residential building with ${units} units and no individual unit BBLs`);
    console.log(`[OwnershipClassifier] BBL ${bbl}: +20 for residential >10 units, no unit BBLs`, { 
      units, landUse: lu 
    });
  }

  // Collect diagnostic evidence
  if (bc && !evidence.some(e => e.includes('Building Class'))) {
    evidence.push(`Building Class: ${bc}`);
  }
  if (lu) evidence.push(`Land Use: ${lu}`);
  if (units > 0) evidence.push(`Residential Units: ${units}`);

  // Add warning about DOF codes if applicable
  const bcFirstChar = bc.charAt(0);
  if ((bcFirstChar === 'C' || bcFirstChar === 'D') && bc.length >= 2) {
    warnings.push(
      `Building class ${bc} is a DOF tax classification for apartment buildings. ` +
      'This does NOT confirm cooperative ownership. Many rental buildings share these classifications.'
    );
  }

  console.log(`[OwnershipClassifier] BBL ${bbl}: Final score computed`, { 
    score, 
    hasExplicitCoopEvidence, 
    units, 
    hasMultipleUnitBBLs,
    bc,
    landUse: lu 
  });

  // ============ LABEL MAPPING ============
  if (score >= 80 && hasExplicitCoopEvidence) {
    return {
      ownershipTypeLabel: 'Likely co-op',
      ownershipConfidence: 'high',
      ownershipScore: score,
      ownershipEvidence: evidence,
      ownershipWarnings: warnings,
    };
  }

  if (score >= 40) {
    warnings.push(
      'Based on municipal tax/record patterns; not definitive. ' +
      'Confirm via offering plan / corporation records.'
    );
    return {
      ownershipTypeLabel: 'Possible co-op (unconfirmed)',
      ownershipConfidence: 'medium',
      ownershipScore: score,
      ownershipEvidence: evidence,
      ownershipWarnings: warnings,
    };
  }

  // Default: Unknown / not specified
  if (evidence.length === 0) {
    evidence.push('No ownership indicators found in municipal data');
  }
  
  return {
    ownershipTypeLabel: 'Unknown / not specified',
    ownershipConfidence: 'low',
    ownershipScore: score,
    ownershipEvidence: evidence,
    ownershipWarnings: warnings,
  };
}

function classifyProperty(
  buildingClass: string | null,
  landUse: string | null,
  unitsRes: number | null,
  condoNo: string | number | null
): PropertyClassification {
  const bc = (buildingClass || '').toUpperCase().trim();
  const lu = (landUse || '').trim();

  // Check for condo first (explicit condo class or condo number present)
  if (CONDO_CLASSES.some(c => bc.startsWith(c))) {
    return { propertyTypeLabel: 'Condo', propertyTenure: 'CONDO' };
  }
  if (condoNo && String(condoNo).trim() !== '' && String(condoNo) !== '0') {
    return { propertyTypeLabel: 'Condo', propertyTenure: 'CONDO' };
  }

  // NOTE: We no longer infer Co-op from C/D building classes
  // Only explicit "Cooperative" text would trigger this in ownership profile

  // Check for commercial land use
  if (COMMERCIAL_LAND_USES.includes(lu)) {
    return { propertyTypeLabel: 'Commercial', propertyTenure: 'RENTAL_OR_OTHER' };
  }

  // Check for mixed-use
  if (MIXED_USE_LAND_USES.includes(lu)) {
    return { propertyTypeLabel: 'Mixed-Use', propertyTenure: 'RENTAL_OR_OTHER' };
  }

  // Check building class patterns for 1-2 family
  if (ONE_TWO_FAMILY_CLASSES.some(c => bc.startsWith(c))) {
    return { propertyTypeLabel: '1-2 Family', propertyTenure: 'RENTAL_OR_OTHER' };
  }

  // Fallback based on unit count
  if (unitsRes !== null) {
    if (unitsRes <= 2) return { propertyTypeLabel: '1-2 Family', propertyTenure: 'RENTAL_OR_OTHER' };
    if (unitsRes >= 3) return { propertyTypeLabel: '3+ Family', propertyTenure: 'RENTAL_OR_OTHER' };
  }

  // Land use fallback
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
  // Ownership classification with confidence
  ownershipTypeLabel: OwnershipLabel;
  ownershipConfidence: OwnershipConfidence;
  ownershipScore: number;
  ownershipEvidence: string[];
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
  
  // Note: hasMultipleUnitBBLs and unitBBLCount should be passed in from frontend 
  // if available. For now, we use 0/false as defaults.
  const ownership = computeOwnershipProfile(
    buildingClass, 
    condoNo, 
    landUse, 
    unitsRes,
    bbl, 
    false, // hasMultipleUnitBBLs - would need to be passed from frontend
    0,     // unitBBLCount - would need to be passed from frontend
    raw
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
    ownershipTypeLabel: ownership.ownershipTypeLabel,
    ownershipConfidence: ownership.ownershipConfidence,
    ownershipScore: ownership.ownershipScore,
    ownershipEvidence: ownership.ownershipEvidence,
    ownershipWarnings: ownership.ownershipWarnings,
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

    // Discover schema
    const schema = await discoverSchema(NYC_OPEN_DATA_APP_TOKEN);
    
    logRequest(ctx, 'Schema discovered', { 
      bblColumn: schema.columnMap.bbl,
      buildingClassColumn: schema.columnMap.buildingClass,
      landUseColumn: schema.columnMap.landUse,
    });

    if (!schema.columnMap.bbl) {
      return createErrorResponse(ctx, 400, 'Schema mismatch', 'PLUTO dataset does not have a bbl column',
        'Unable to query property profile—schema mismatch.');
    }

    // Query PLUTO
    const dataUrl = new URL(PLUTO_BASE_URL);
    dataUrl.searchParams.set('$where', `${schema.columnMap.bbl}='${bbl}'`);
    dataUrl.searchParams.set('$limit', '1');

    logRequest(ctx, 'Fetching from PLUTO', { url: dataUrl.toString() });

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
      // No data found - return a minimal profile
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
        ownershipTypeLabel: 'Unknown / not specified',
        ownershipConfidence: 'low',
        ownershipScore: 0,
        ownershipEvidence: ['No property data available'],
        ownershipWarnings: [],
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
      ownershipType: profile.ownershipTypeLabel,
      ownershipScore: profile.ownershipScore,
      buildingClass: profile.buildingClass,
      units: profile.residentialUnits,
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
