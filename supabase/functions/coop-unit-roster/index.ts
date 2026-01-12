import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data DOF Rolling Sales dataset
// https://data.cityofnewyork.us/dataset/NYC-Citywide-Annualized-Calendar-Sales-Update/w2pb-icbu
const DATASET_ID = 'usep-8jbt';  // Rolling Sales (current year + recent)
const NYC_OPEN_DATA_BASE = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`;

// ============ Unit Normalization (must match client-side logic) ============

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

// ============ Request Utilities ============

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
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes (sales data changes slowly)

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

// ============ Unit Aggregation ============

interface UnitRosterEntry {
  unit: string;
  count: number;
  lastSeen: string | null;
  source: string;
}

interface ApiResponse {
  bbl: string;
  units: UnitRosterEntry[];
  totalRecordsScanned: number;
  warning?: string;
  requestId: string;
}

function validateBBL(bbl: string): boolean {
  return /^\d{10}$/.test(bbl);
}

// Extract apartment/unit from a sales record
const UNIT_FIELDS = ['apartment_number', 'apartment', 'apt', 'unit', 'unit_number', 'apt_no'];

function extractUnitFromSalesRecord(record: Record<string, unknown>): string | null {
  for (const field of UNIT_FIELDS) {
    const value = record[field];
    if (value != null && value !== '') {
      const normalized = normalizeUnit(String(value));
      if (normalized) return normalized;
    }
  }
  return null;
}

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  try {
    if (dateStr.includes('T')) return new Date(dateStr).toISOString().split('T')[0];
    // Handle other date formats
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date.toISOString().split('T')[0];
    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ctx = createRequestContext('coop-unit-roster');
  const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

  // ===== Request logging (debug) =====
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    console.log(
      JSON.stringify({
        requestId: ctx.requestId,
        endpoint: ctx.endpoint,
        message: 'Incoming request',
        method: req.method,
        url: req.url,
        query: {
          bbl: params.get('bbl') || params.get('BBL'),
          bin: params.get('bin') || params.get('BIN'),
          address: params.get('address'),
          limit: params.get('limit'),
          offset: params.get('offset'),
        },
      })
    );
  } catch {
    // ignore logging errors
  }

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

    // Try to get BBL from query params first, then from JSON body
    let bbl: string | null = null;
    let limit = 200;
    let offset = 0;
    
    // Check query params
    for (const key of ['bbl', 'BBL']) {
      const v = params.get(key);
      if (v?.trim()) { bbl = v.trim(); break; }
    }
    
    // If not in query params, try JSON body
    if (!bbl && req.method === 'POST') {
      try {
        const body = await req.json();
        if (body.bbl) bbl = String(body.bbl).trim();
        if (body.limit) limit = parseInt(String(body.limit), 10);
        if (body.offset) offset = parseInt(String(body.offset), 10);
      } catch {
        // Body parsing failed, continue with what we have
      }
    }

    if (!bbl) {
      return createErrorResponse(ctx, 400, 'Missing parameter', 'bbl parameter is required', 'Please provide a valid property identifier (BBL).');
    }

    bbl = bbl.padStart(10, '0');
    ctx.bbl = bbl;

    if (!validateBBL(bbl)) {
      return createErrorResponse(ctx, 400, 'Invalid BBL', 'bbl must be exactly 10 digits', 'The property identifier (BBL) format is invalid.');
    }

    // Apply limits from query params if present (they take precedence)
    const queryLimit = params.get('limit');
    const queryOffset = params.get('offset');
    if (queryLimit) limit = parseInt(queryLimit, 10);
    if (queryOffset) offset = parseInt(queryOffset, 10);
    
    limit = Math.min(Math.max(1, limit), 500);
    offset = Math.max(0, offset);

    const cacheKey = `coop-unit-roster:${bbl}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) {
      logRequest(ctx, 'Cache hit');
      return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build BBL components for the query
    // Rolling sales uses separate borough/block/lot columns
    const borough = bbl.substring(0, 1);
    const block = parseInt(bbl.substring(1, 6), 10).toString(); // Remove leading zeros
    const lot = parseInt(bbl.substring(6, 10), 10).toString();   // Remove leading zeros

    // Query rolling sales for this property
    // The dataset has: borough, block, lot, apartment_number, sale_date, sale_price, etc.
    const whereClause = `borough='${borough}' AND block='${block}' AND lot='${lot}'`;

    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit));
    dataUrl.searchParams.set('$offset', String(offset));
    dataUrl.searchParams.set('$order', 'sale_date DESC NULL LAST');

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (NYC_OPEN_DATA_APP_TOKEN) {
      headers['X-App-Token'] = NYC_OPEN_DATA_APP_TOKEN;
    }

    logRequest(ctx, 'Fetching from Rolling Sales', { borough, block, lot, limit });

    const result = await fetchWithRetry(dataUrl.toString(), { headers });

    // Handle upstream errors gracefully
    if (!result.ok) {
      const upstreamStatus = result.status;
      
      // For 403/401, return empty with warning (dataset may require login)
      if (upstreamStatus === 403 || upstreamStatus === 401) {
        const response: ApiResponse = {
          bbl,
          units: [],
          totalRecordsScanned: 0,
          warning: 'rolling_sales_unavailable',
          requestId: ctx.requestId,
        };
        logRequest(ctx, 'Rolling sales unavailable (auth required)', { upstreamStatus });
        return new Response(JSON.stringify(response), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (upstreamStatus === 429) {
        return createErrorResponse(ctx, 429, 'Upstream rate limit', 'NYC Open Data rate limit exceeded',
          'The NYC data service is busy. Please try again in a moment.', { service: 'NYC Open Data', status: 429 });
      }

      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown error',
        'Unable to retrieve sales data. Please try again later.', { service: 'NYC Open Data', status: upstreamStatus });
    }

    const rawData = result.data as Record<string, unknown>[];
    logRequest(ctx, 'Raw sales records fetched', { count: rawData.length });

    // Aggregate units from sales records
    const unitMap = new Map<string, { count: number; lastSeen: string | null }>();

    for (const record of rawData) {
      const unit = extractUnitFromSalesRecord(record);
      if (unit) {
        const existing = unitMap.get(unit) || { count: 0, lastSeen: null };
        existing.count++;
        
        // Track most recent sale date
        const saleDate = parseDateToISO(record.sale_date as string);
        if (saleDate && (!existing.lastSeen || saleDate > existing.lastSeen)) {
          existing.lastSeen = saleDate;
        }
        
        unitMap.set(unit, existing);
      }
    }

    // Convert to array and sort by count descending
    const units: UnitRosterEntry[] = Array.from(unitMap.entries())
      .map(([unit, data]) => ({
        unit,
        count: data.count,
        lastSeen: data.lastSeen,
        source: 'rolling_sales',
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.unit.localeCompare(b.unit, undefined, { numeric: true });
      });

    const response: ApiResponse = {
      bbl,
      units,
      totalRecordsScanned: rawData.length,
      requestId: ctx.requestId,
    };

    setCache(cacheKey, response);
    logRequest(ctx, 'Success', { unitsFound: units.length, recordsScanned: rawData.length });

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return createErrorResponse(ctx, 500, 'Internal server error',
      error instanceof Error ? error.message : 'Unknown error',
      'An unexpected error occurred. Please try again.');
  }
});
