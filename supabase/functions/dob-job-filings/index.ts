import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data DOB Job Applications Filing dataset
// https://data.cityofnewyork.us/Housing-Development/DOB-Job-Application-Filings/ic3t-wcy2
const DATASET_ID = 'ic3t-wcy2';
const NYC_OPEN_DATA_BASE = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`;

// ============ Unit Extraction (must match client-side logic) ============

const JUNK_VALUES = new Set([
  '', 'N/A', 'NA', 'NONE', 'UNKNOWN', '0', '-', 'N', 'NULL', 'BUILDING', 'BLDG',
  'BASEMENT', 'CELLAR', 'ROOF', 'COMMON', 'LOBBY', 'HALLWAY'
]);

const STRIP_PREFIXES = [
  'APARTMENT', 'APT\\.?', 'UNIT', 'SUITE', 'STE\\.?', 'ROOM', 'RM\\.?',
  'FLOOR', 'FL\\.?', '#', 'NO\\.?', 'NUMBER'
];

const ADDRESS_SUBSTRINGS = [
  'STREET', 'ST', 'AVENUE', 'AVE', 'ROAD', 'RD', 'BOULEVARD', 'BLVD',
  'PLACE', 'PL', 'DRIVE', 'DR', 'LANE', 'LN', 'WEST', 'EAST', 'NORTH', 'SOUTH'
];

function containsAddressSubstring(raw: string): boolean {
  const upper = raw.toUpperCase();
  return ADDRESS_SUBSTRINGS.some(substr => {
    const regex = new RegExp(`\\b${substr}\\b`, 'i');
    return regex.test(upper);
  });
}

function isLikelyUnitLabel(unit: string): boolean {
  if (!unit) return false;
  if (unit.length < 1 || unit.length > 6) return false;
  if (/^\d+$/.test(unit) && unit.length >= 3) return false;
  if (/^\d{5}$/.test(unit)) return false;

  const allowedPatterns = [
    /^\d{1,2}[A-Z]?$/,
    /^\d{1,2}[A-Z]{1,2}$/,
    /^(PH|TH|LH|RH|BS|GF)\d?[A-Z]?$/,
    /^[A-Z]{1,2}\d{1,2}$/,
    /^\d?[A-Z]{1,2}$/,
  ];

  return allowedPatterns.some(pattern => pattern.test(unit));
}

function normalizeUnit(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  let value = String(raw).trim().toUpperCase();
  if (JUNK_VALUES.has(value)) return null;
  if (containsAddressSubstring(value)) return null;

  const prefixPattern = new RegExp(`^(${STRIP_PREFIXES.join('|')})\\s*[:\\-\\.\\s]*`, 'i');
  value = value.replace(prefixPattern, '');
  value = value.replace(/[\s\-\.]+/g, '');
  value = value.replace(/[^A-Z0-9]/g, '');

  if (!value || JUNK_VALUES.has(value)) return null;
  if (!/[A-Z0-9]/.test(value)) return null;
  if (!isLikelyUnitLabel(value)) return null;

  return value;
}

// Extract unit tokens from free text (job description, work on floors, etc.)
// CRITICAL: Use negative lookahead (?!S\b) to prevent matching plurals like "UNITS" -> "S"
const UNIT_EXTRACTION_PATTERNS = [
  /\bAPT\.?(?!S\b)\s*([A-Z0-9]{1,6})\b/gi,
  /\bAPARTMENT(?!S\b)\s*([A-Z0-9]{1,6})\b/gi,
  /\bUNIT(?!S\b)\s*([A-Z0-9]{1,6})\b/gi,
  /\b#\s*([A-Z0-9]{1,6})\b/g,
  /\bPENTHOUSE\s*([A-Z0-9]{0,3})\b/gi,
  /\bPH[\s\-]?([A-Z0-9]{0,3})\b/gi,
  /\bRM\.?(?!S\b)\s*([A-Z0-9]{1,6})\b/gi,
  /\bROOM(?!S\b)\s*([A-Z0-9]{1,6})\b/gi,
  /\bSTE\.?(?!S\b)\s*([A-Z0-9]{1,6})\b/gi,
  /\bSUITE(?!S\b)\s*([A-Z0-9]{1,6})\b/gi,
];

// Single letters that are almost never real units (common false positives)
const BANNED_SINGLE_LETTERS = new Set(['S', 'I', 'A', 'E', 'O']);

function extractUnitTokensFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  
  const units = new Set<string>();
  const upperText = String(text).toUpperCase();
  
  for (const pattern of UNIT_EXTRACTION_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(upperText)) !== null) {
      const candidate = (match[1] || '').trim();
      
      // For penthouse without number, use "PH"
      if (pattern.source.includes('PENTHOUSE') && !candidate) {
        const normalized = normalizeUnit('PH');
        if (normalized) units.add(normalized);
      } else if (pattern.source.includes('PH[') && !candidate) {
        const normalized = normalizeUnit('PH');
        if (normalized) units.add(normalized);
      } else {
        // CRITICAL: Reject single-letter extractions that are common false positives
        // unless the source text literally contains "UNIT <letter>" with explicit spacing
        if (/^[A-Z]$/.test(candidate)) {
          if (BANNED_SINGLE_LETTERS.has(candidate)) {
            continue; // Skip common false positives like "S" from "UNITS"
          }
          // For other single letters, require explicit "UNIT X" pattern
          const explicitPattern = new RegExp(`\\bUNIT\\s+${candidate}\\b`, 'i');
          if (!explicitPattern.test(upperText)) {
            continue;
          }
        }
        
        const normalized = normalizeUnit(candidate);
        if (normalized) units.add(normalized);
      }
    }
  }
  
  return Array.from(units);
}

// ============ Request Utilities ============

function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

interface RequestContext {
  requestId: string;
  endpoint: string;
  bin?: string;
  startTime: number;
}

function createRequestContext(endpoint: string, bin?: string): RequestContext {
  return { requestId: generateRequestId(), endpoint, bin, startTime: Date.now() };
}

function logRequest(ctx: RequestContext, message: string, extra?: Record<string, unknown>) {
  const duration = Date.now() - ctx.startTime;
  console.log(JSON.stringify({ requestId: ctx.requestId, endpoint: ctx.endpoint, bin: ctx.bin, durationMs: duration, message, ...extra }));
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
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getCached<T>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) responseCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

async function fetchWithRetry(url: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return { ok: true, status: response.status, data: await response.json() };
      }
      if (response.status >= 500 && attempt < 2) {
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      return { ok: false, status: response.status, error: await response.text() };
    } catch (error) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, status: 0, error: 'All retry attempts failed' };
}

// ============ Response Types ============

interface JobFilingRecord {
  jobNumber: string;
  filingNumber: string | null;
  jobType: string | null;
  filingStatus: string | null;
  address: string | null;
  workOnFloors: string | null;
  jobDescription: string | null;
  modifiedDate: string | null;
  extractedUnits: string[];
  raw: Record<string, unknown>;
}

interface UnitFromFilings {
  unit: string;
  count: number;
  lastSeen: string | null;
  source: string;
  filings: {
    jobNumber: string;
    jobType: string | null;
    status: string | null;
    modifiedDate: string | null;
    snippet: string | null;
  }[];
}

interface ApiResponse {
  bin: string;
  filings: JobFilingRecord[];
  units: UnitFromFilings[];
  totalFilings: number;
  fallbackMode: boolean;
  dobNowUrl: string;
  requestId: string;
}

function validateBIN(bin: string): boolean {
  return /^\d{7}$/.test(bin);
}

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  try {
    if (dateStr.includes('T')) return new Date(dateStr).toISOString().split('T')[0];
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    return null;
  } catch {
    return null;
  }
}

// Extract snippet containing the unit reference
function extractSnippet(text: string, unit: string, maxLength: number = 100): string | null {
  if (!text) return null;
  const upper = text.toUpperCase();
  const patterns = [
    new RegExp(`\\bAPT\\.?\\s*${unit}\\b`, 'gi'),
    new RegExp(`\\bAPARTMENT\\s*${unit}\\b`, 'gi'),
    new RegExp(`\\bUNIT\\s*${unit}\\b`, 'gi'),
    new RegExp(`\\b#\\s*${unit}\\b`, 'g'),
    new RegExp(`\\b${unit}\\b`, 'gi'),
  ];
  
  for (const pattern of patterns) {
    const match = pattern.exec(upper);
    if (match) {
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      let snippet = text.substring(start, end);
      if (start > 0) snippet = '...' + snippet;
      if (end < text.length) snippet = snippet + '...';
      return snippet.substring(0, maxLength);
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ctx = createRequestContext('dob-job-filings');
  const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

  try {
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

    // Try to get BIN from query params first, then from JSON body
    let bin: string | null = null;
    let limit = 100;
    let offset = 0;
    
    for (const key of ['bin', 'BIN']) {
      const v = params.get(key);
      if (v?.trim()) { bin = v.trim(); break; }
    }
    
    // If not in query params, try JSON body
    if (!bin && req.method === 'POST') {
      try {
        const body = await req.json();
        if (body.bin) bin = String(body.bin).trim();
        if (body.limit) limit = parseInt(String(body.limit), 10);
        if (body.offset) offset = parseInt(String(body.offset), 10);
      } catch {
        // Body parsing failed
      }
    }

    if (!bin) {
      return createErrorResponse(ctx, 400, 'Missing parameter', 'bin parameter is required', 'Please provide a valid Building Identification Number (BIN).');
    }

    bin = bin.padStart(7, '0');
    ctx.bin = bin;

    if (!validateBIN(bin)) {
      return createErrorResponse(ctx, 400, 'Invalid BIN', 'bin must be exactly 7 digits', 'The Building Identification Number (BIN) format is invalid.');
    }

    // Apply limits from query params
    const queryLimit = params.get('limit');
    const queryOffset = params.get('offset');
    if (queryLimit) limit = parseInt(queryLimit, 10);
    if (queryOffset) offset = parseInt(queryOffset, 10);
    
    limit = Math.min(Math.max(1, limit), 200);
    offset = Math.max(0, offset);

    const cacheKey = `dob-job-filings:${bin}:${limit}:${offset}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) {
      logRequest(ctx, 'Cache hit');
      return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // DOB NOW link for fallback
    const dobNowUrl = `https://a810-dobnow.nyc.gov/Publish/#!/dashboard?q=${bin}`;

    // Query DOB Job Applications by BIN
    const whereClause = `bin__='${bin}'`;

    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit));
    dataUrl.searchParams.set('$offset', String(offset));
    dataUrl.searchParams.set('$order', 'latest_action_date DESC NULL LAST');

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (NYC_OPEN_DATA_APP_TOKEN) {
      headers['X-App-Token'] = NYC_OPEN_DATA_APP_TOKEN;
    }

    logRequest(ctx, 'Fetching from DOB Job Filings', { bin, limit });

    const result = await fetchWithRetry(dataUrl.toString(), { headers });

    // Handle fallback mode if API unavailable
    if (!result.ok) {
      const upstreamStatus = result.status;
      
      if (upstreamStatus === 403 || upstreamStatus === 401) {
        // Fallback mode - return empty with link
        const response: ApiResponse = {
          bin,
          filings: [],
          units: [],
          totalFilings: 0,
          fallbackMode: true,
          dobNowUrl,
          requestId: ctx.requestId,
        };
        logRequest(ctx, 'Fallback mode (auth required)', { upstreamStatus });
        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (upstreamStatus === 429) {
        return createErrorResponse(ctx, 429, 'Upstream rate limit', 'NYC Open Data rate limit exceeded',
          'The NYC data service is busy. Please try again in a moment.', { service: 'NYC Open Data', status: 429 });
      }

      // For other errors, return fallback mode
      const response: ApiResponse = {
        bin,
        filings: [],
        units: [],
        totalFilings: 0,
        fallbackMode: true,
        dobNowUrl,
        requestId: ctx.requestId,
      };
      logRequest(ctx, 'Fallback mode (upstream error)', { upstreamStatus, error: result.error });
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawData = result.data as Record<string, unknown>[];
    logRequest(ctx, 'Raw filings fetched', { count: rawData.length });

    // Process filings and extract units
    const filings: JobFilingRecord[] = [];
    const unitMap = new Map<string, UnitFromFilings>();

    for (const raw of rawData) {
      const jobNumber = String(raw.job__ || raw.job_number || raw.jobnumber || 'Unknown');
      const jobDescription = raw.job_description as string || raw.jobdescription as string || '';
      const workOnFloors = raw.existing_occupancy as string || raw.proposed_occupancy as string || '';
      const modifiedDate = parseDateToISO(raw.latest_action_date as string || raw.pre_filing_date as string);
      
      // Extract units from text fields
      const textToSearch = [jobDescription, workOnFloors].filter(Boolean).join(' ');
      const extractedUnits = extractUnitTokensFromText(textToSearch);
      
      const filing: JobFilingRecord = {
        jobNumber,
        filingNumber: raw.doc__ as string || null,
        jobType: raw.job_type as string || null,
        filingStatus: raw.job_status as string || raw.filing_status as string || null,
        address: raw.house__ as string 
          ? `${raw.house__} ${raw.street_name || ''}`
          : raw.address as string || null,
        workOnFloors,
        jobDescription,
        modifiedDate,
        extractedUnits,
        raw,
      };
      
      filings.push(filing);

      // Aggregate units
      for (const unit of extractedUnits) {
        const existing = unitMap.get(unit) || {
          unit,
          count: 0,
          lastSeen: null,
          source: 'dob_filings',
          filings: [],
        };
        
        existing.count++;
        if (modifiedDate && (!existing.lastSeen || modifiedDate > existing.lastSeen)) {
          existing.lastSeen = modifiedDate;
        }
        
        // Add filing reference with snippet
        const snippet = extractSnippet(textToSearch, unit);
        existing.filings.push({
          jobNumber,
          jobType: filing.jobType,
          status: filing.filingStatus,
          modifiedDate,
          snippet,
        });
        
        unitMap.set(unit, existing);
      }
    }

    // Convert to array and sort
    const units = Array.from(unitMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.unit.localeCompare(b.unit, undefined, { numeric: true });
    });

    const response: ApiResponse = {
      bin,
      filings,
      units,
      totalFilings: filings.length,
      fallbackMode: false,
      dobNowUrl,
      requestId: ctx.requestId,
    };

    setCache(cacheKey, response);
    logRequest(ctx, 'Success', { filingsCount: filings.length, unitsFound: units.length });

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return createErrorResponse(ctx, 500, 'Internal server error',
      error instanceof Error ? error.message : 'Unknown error',
      'An unexpected error occurred. Please try again.');
  }
});
