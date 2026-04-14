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
type OwnershipConfidenceLevel = 'Confirmed' | 'Market-known' | 'Unverified';
type InferredConfidenceLevel = 'Low' | 'Medium' | 'High';
type OwnershipStructureType = 'Condominium' | 'Cooperative' | 'Unknown';

const CONDO_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'RR', 'RS'];
const ONE_TWO_FAMILY_CLASSES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'B1', 'B2', 'B3', 'B9'];
const MIXED_USE_LAND_USES = ['04'];
const COMMERCIAL_LAND_USES = ['05', '06', '07', '08', '09', '10', '11'];
// DOF official co-op building classes — these are definitive municipal classifications
// D4: Elevator Co-op, C6: Walk-Up Co-op, C8: Walk-Up Co-op (converted)
const COOP_DEFINITIVE_CLASSES = ['D4', 'C6', 'C8'];
// These building classes are common for co-ops but not definitive
// D0: Elevator (loft conversion), D6: Elevator w/stores, D7: Elevator w/parking, D8: Elevator w/professional, D9: Elevator misc
const COOP_INDICATOR_CLASSES = ['D0', 'D6', 'D7', 'D8', 'D9'];

// Owner name patterns that strongly indicate a cooperative corporation
// Note: PLUTO truncates ownername, so "OWNERS CORP" may appear as "OWNERS C"
const COOP_OWNER_PATTERNS = [
  /OWNERS?\s*CORP/i,
  /OWNERS?\s*C$/i,             // truncated "OWNERS CORP"
  /HOUSING\s*CORP/i,
  /HOUSING\s*DEVELOP/i,        // truncated "HOUSING DEVELOPMENT FUND CORP" (HDFC)
  /TE?NNANTS?\s*CORP/i,        // includes misspelling "TENNANTS"
  /TENANTS?\s*C$/i,            // truncated
  /COOPERATIVE/i,
  /\bCO[\-\s]?OP\b/i,
  /\bHDFC\b/i,
  /MUTUAL\s*HOUSING/i,
  /APARTMENT\s*CORP/i,
  /\bAPT\s*CORP/i,
];

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
  inferredConfidence: InferredConfidenceLevel;
  coopLikelihoodScore: number;
  indicators: string[];
  sources: string[];
  disclaimerKey: 'unverified' | 'market-known';
}

// Scoring inputs
interface ScoringInputs {
  unitsResidential: number | null;
  condoUnitsCount: number;
  hasCondoFlag: boolean;
  unitBblCount: number | null;
  mentionedUnitCount: number;
  salesRecordsCount: number;
  unitSalesCount: number;
  buildingClass: string | null;
  ownerName: string | null;
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
 * Uses hard municipal data to classify ownership:
 * - Condominium: condoNo field set, or condo unit BBL splits exist
 * - Cooperative: DOF building class is a definitive co-op class (D4, C6, C8)
 * - Not specified: everything else falls to Layer 2 scoring
 */

type MunicipalOwnershipLabelV2 = 'Condominium' | 'Cooperative' | 'Ownership type not specified in municipal data';

function computeMunicipalClassification(
  condoNo: string | number | null,
  condoUnitsCount: number,
  buildingClass: string | null,
  landUse: string | null,
  residentialUnits: number | null,
  ownerName: string | null
): MunicipalClassification {
  const bc = (buildingClass || '').toUpperCase().trim();
  const evidence: string[] = [];

  // Check for explicit condo indicators
  const hasExplicitCondoNo = condoNo !== null && condoNo !== undefined &&
    String(condoNo).trim() !== '' && String(condoNo) !== '0';

  // If condo unit BBLs exist, this is a condominium
  if (condoUnitsCount > 0) {
    evidence.push(`Condo unit BBLs detected: ${condoUnitsCount} unit(s)`);
    if (hasExplicitCondoNo) {
      evidence.push(`Condo Number: ${condoNo}`);
    }

    return {
      label: 'Condominium',
      evidence,
      source: 'NYC DOF (Department of Finance)',
    };
  }

  // If explicit condoNo exists, this is a condominium
  if (hasExplicitCondoNo) {
    evidence.push(`Condo Number: ${condoNo} (explicit municipal indicator)`);

    return {
      label: 'Condominium',
      evidence,
      source: 'NYC DOF (Department of Finance)',
    };
  }

  // Check for DOF definitive co-op building classes (D4, C6, C8)
  if (COOP_DEFINITIVE_CLASSES.some(c => bc.startsWith(c))) {
    evidence.push(`Building Class: ${bc} (DOF cooperative classification)`);
    if (ownerName) evidence.push(`Owner: ${ownerName}`);
    if (residentialUnits) evidence.push(`Residential Units: ${residentialUnits}`);

    return {
      label: 'Ownership type not specified in municipal data', // keep type compatible
      evidence,
      source: 'NYC DOF (Department of Finance)',
    };
  }

  // Default: not specified in municipal data
  if (bc) evidence.push(`Building Class: ${bc}`);
  if (landUse) evidence.push(`Land Use: ${landUse}`);
  if (residentialUnits) evidence.push(`Residential Units: ${residentialUnits}`);
  if (ownerName) evidence.push(`Owner: ${ownerName}`);

  return {
    label: 'Ownership type not specified in municipal data',
    evidence: evidence.length > 0 ? evidence : ['No explicit ownership indicators in municipal data'],
    source: 'NYC PLUTO/DOB',
  };
}

/**
 * SECTION B: Ownership Structure Scoring
 *
 * Computes a co-op likelihood score (0-10) based on structural evidence.
 *
 * Signal weights (redesigned for accuracy):
 *   Definitive co-op building class (D4, C6, C8)     → +8 (near-certain)
 *   Owner name matches co-op corporation pattern      → +5
 *   Soft co-op building class (D0, D6-D9)             → +3
 *   Large building on single tax lot (≥10 units)      → +2
 *   Multi-unit with no condo indicators               → +2
 *   Unit mentions in records                          → +1-2
 *   Building-level sales only                         → +1
 */
function computeOwnershipStructure(
  municipal: MunicipalClassification,
  inputs: ScoringInputs
): OwnershipStructure {
  const indicators: string[] = [];
  let score = 0;

  // HARD BLOCK: If condo indicators exist, this is a condominium
  if (inputs.condoUnitsCount > 0 || inputs.hasCondoFlag) {
    if (inputs.condoUnitsCount > 0) {
      indicators.push(`Condo unit BBLs detected (${inputs.condoUnitsCount} units)`);
    }
    if (inputs.hasCondoFlag) {
      indicators.push('Municipal condo flag detected');
    }

    return {
      type: 'Condominium',
      confidence: 'Confirmed',
      inferredConfidence: 'High',
      coopLikelihoodScore: 0,
      indicators,
      sources: ['NYC DOF'],
      disclaimerKey: 'unverified',
    };
  }

  const unitsRes = inputs.unitsResidential ?? 0;
  const unitBblCount = inputs.unitBblCount ?? 0;
  const mentionedUnitCount = inputs.mentionedUnitCount;
  const bc = (inputs.buildingClass || '').toUpperCase().trim();
  const owner = (inputs.ownerName || '').toUpperCase().trim();

  // ── Signal 1: Definitive DOF co-op building class (D4, C6, C8) ──
  // These are the DOF's own official classifications meaning "cooperatively owned"
  if (COOP_DEFINITIVE_CLASSES.some(c => bc.startsWith(c))) {
    score += 8;
    indicators.push(`Building class ${bc} — DOF cooperative classification`);
  }

  // ── Signal 2: Owner name matches co-op corporation patterns ──
  // Co-op buildings are owned by a corporation; PLUTO owner names reflect this
  if (owner && COOP_OWNER_PATTERNS.some(p => p.test(owner))) {
    score += 5;
    indicators.push(`Owner "${inputs.ownerName}" matches cooperative corporation pattern`);
  }

  // ── Signal 3: Soft co-op building class (D0, D6, D7, D8, D9) ──
  // Common for co-ops but not exclusive — elevator buildings that could be rental
  if (!COOP_DEFINITIVE_CLASSES.some(c => bc.startsWith(c)) &&
      COOP_INDICATOR_CLASSES.some(c => bc.startsWith(c))) {
    score += 3;
    indicators.push(`Building class ${bc} is common for co-ops`);
  }

  // ── Signal 4: Large building on single tax lot ──
  if (unitsRes >= 10 && (unitBblCount === 0 || inputs.unitBblCount === null)) {
    score += 2;
    indicators.push(`${unitsRes} residential units on a single tax lot`);
  }

  // ── Signal 5: Multi-unit with no condo indicators ──
  if (unitsRes >= 3 && inputs.condoUnitsCount === 0 && !inputs.hasCondoFlag) {
    score += 2;
    indicators.push('Multi-unit building with no condo BBL splits');
  }

  // ── Signal 6: Unit mentions in records ──
  if (mentionedUnitCount >= 20) {
    score += 2;
    indicators.push(`${mentionedUnitCount} records reference apartment/unit numbers`);
  } else if (mentionedUnitCount >= 5) {
    score += 1;
    indicators.push(`${mentionedUnitCount} records reference apartment/unit numbers`);
  }

  // ── Signal 7: Building-level sales without unit sales ──
  if (inputs.salesRecordsCount > 0 && inputs.unitSalesCount === 0) {
    score += 1;
    indicators.push('Building-level sales without unit sales records');
  }

  // CAP: Small buildings (≤2 units) are almost never co-ops
  if (unitsRes > 0 && unitsRes <= 2) {
    score = Math.min(score, 3);
    indicators.push('Small building (≤2 units) — score capped');
  }

  // Clamp to 10
  score = Math.min(score, 10);

  // ── Determine type and confidence ──
  // Score ≥ 8: Confirmed co-op (definitive building class or strong multi-signal)
  // Score ≥ 5: Likely co-op (market-known, medium confidence)
  // Score < 5: Unknown
  if (score >= 8) {
    return {
      type: 'Cooperative',
      confidence: 'Confirmed',
      inferredConfidence: 'High',
      coopLikelihoodScore: score,
      indicators,
      sources: ['NYC DOF building classification', 'PLUTO'],
      disclaimerKey: 'market-known',
    };
  }

  if (score >= 5) {
    return {
      type: 'Cooperative',
      confidence: 'Market-known',
      inferredConfidence: 'Medium',
      coopLikelihoodScore: score,
      indicators,
      sources: ['Structural analysis'],
      disclaimerKey: 'market-known',
    };
  }

  return {
    type: 'Unknown',
    confidence: 'Unverified',
    inferredConfidence: 'Low',
    coopLikelihoodScore: score,
    indicators: indicators.length > 0 ? indicators : ['Insufficient structural evidence'],
    sources: [],
    disclaimerKey: 'unverified',
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
  bbl: string,
  scoringInputs: ScoringInputs
): OwnershipProfile {
  const municipal = computeMunicipalClassification(
    condoNo,
    scoringInputs.condoUnitsCount,
    buildingClass,
    landUse,
    residentialUnits,
    scoringInputs.ownerName
  );
  
  const ownership = computeOwnershipStructure(municipal, scoringInputs);

  const warnings: string[] = [];

  if (ownership.confidence === 'Unverified') {
    warnings.push(
      'DOB and PLUTO data do not reliably indicate cooperative ownership.'
    );
  }

  console.log(`[OwnershipClassifier] BBL ${bbl}:`, {
    municipal: municipal.label,
    ownership: `${ownership.type} (${ownership.confidence})`,
    score: ownership.coopLikelihoodScore,
    indicators: ownership.indicators,
    condoNo,
    buildingClass,
  });

  return { municipal, ownership, warnings };
}

function classifyProperty(
  buildingClass: string | null,
  landUse: string | null,
  unitsRes: number | null,
  condoNo: string | number | null,
  ownerName: string | null
): PropertyClassification {
  const bc = (buildingClass || '').toUpperCase().trim();
  const lu = (landUse || '').trim();
  const owner = (ownerName || '').toUpperCase().trim();

  // Condo detection (hard data)
  if (CONDO_CLASSES.some(c => bc.startsWith(c))) {
    return { propertyTypeLabel: 'Condo', propertyTenure: 'CONDO' };
  }
  if (condoNo && String(condoNo).trim() !== '' && String(condoNo) !== '0') {
    return { propertyTypeLabel: 'Condo', propertyTenure: 'CONDO' };
  }

  // Co-op detection: definitive building class OR owner name pattern
  if (COOP_DEFINITIVE_CLASSES.some(c => bc.startsWith(c))) {
    return { propertyTypeLabel: 'Co-op', propertyTenure: 'COOP' };
  }
  if (owner && COOP_OWNER_PATTERNS.some(p => p.test(owner))) {
    // Owner name says co-op corporation — if also a multi-unit building, classify as co-op
    if (unitsRes === null || unitsRes >= 3) {
      return { propertyTypeLabel: 'Co-op', propertyTenure: 'COOP' };
    }
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

  const ownerName = getValue('ownerName') as string | null;

  // Default scoring inputs - will be enhanced when more data sources are available
  const scoringInputs: ScoringInputs = {
    unitsResidential: unitsRes,
    condoUnitsCount: 0, // Will be populated from condo-units endpoint
    hasCondoFlag: condoNo !== null && condoNo !== undefined &&
      String(condoNo).trim() !== '' && String(condoNo) !== '0',
    unitBblCount: null, // Not yet available
    mentionedUnitCount: 0, // Will be populated from unit-mentions endpoint
    salesRecordsCount: 0, // Not yet available
    unitSalesCount: 0, // Not yet available
    buildingClass,
    ownerName,
  };

  const classification = classifyProperty(buildingClass, landUse, unitsRes, condoNo, ownerName);
  const ownershipProfile = computeOwnershipProfile(
    buildingClass, condoNo, landUse, unitsRes, bbl, scoringInputs
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
    const clientIP = getClientIP(req);
    const rl = checkRateLimit(clientIP);
    if (!rl.allowed) {
      return createErrorResponse(ctx, 429, 'Rate limit exceeded', `Retry after ${rl.retryAfter} seconds`, 'Too many requests. Please wait a moment.');
    }

    const url = new URL(req.url);
    const bbl = url.searchParams.get('bbl');

    if (!bbl) {
      return createErrorResponse(ctx, 400, 'Missing parameter', 'BBL is required', 'Please provide a BBL.');
    }

    ctx.bbl = bbl;

    if (!validateBBL(bbl)) {
      return createErrorResponse(ctx, 400, 'Invalid BBL', `Invalid format: ${bbl}`, 'BBL must be a 10-digit number.');
    }

    // Check cache
    const cacheKey = `profile:${bbl}`;
    const cached = getCached<PropertyProfile>(cacheKey);
    if (cached) {
      logRequest(ctx, 'Cache hit');
      return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Discover schema
    const schema = await discoverSchema(NYC_OPEN_DATA_APP_TOKEN || '');

    // Fetch from PLUTO
    const queryUrl = new URL(PLUTO_BASE_URL);
    queryUrl.searchParams.set('bbl', bbl);

    const result = await fetchWithRetry(queryUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        ...(NYC_OPEN_DATA_APP_TOKEN && { 'X-App-Token': NYC_OPEN_DATA_APP_TOKEN }),
      },
    });

    if (!result.ok) {
      return createErrorResponse(
        ctx, 502, 'Upstream error', result.error || 'PLUTO query failed',
        'Unable to fetch property data. Please try again.',
        { service: 'NYC Open Data', status: result.status }
      );
    }

    const records = result.data as Record<string, unknown>[];
    if (!records || records.length === 0) {
      return createErrorResponse(ctx, 404, 'Not found', `No property found for BBL ${bbl}`, 'Property not found in NYC records.');
    }

    const profile = normalizeProfile(records[0], bbl, schema, ctx.requestId);
    setCache(cacheKey, profile);
    logRequest(ctx, 'Profile fetched', { hasData: !!profile.buildingClass });

    return new Response(JSON.stringify(profile), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Property profile error:', error);
    return createErrorResponse(
      ctx, 500, 'Internal error', error instanceof Error ? error.message : 'Unknown error',
      'An unexpected error occurred. Please try again.'
    );
  }
});
