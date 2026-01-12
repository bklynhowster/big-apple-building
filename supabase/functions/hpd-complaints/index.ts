import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data HPD Complaints and Problems dataset (ygpa-z7cr) - PUBLIC
// Schema verified columns: complaintid, buildingid, boroughid, borough, housenumber, streetname, 
// apartment, zip, block, lot, latitude, longitude, communityboard, status, statusdate, 
// statusid, majorcategory, majorcategoryid, minorcategory, minorcategoryid, code, type, spacetype
// NOTE: This dataset does NOT have a 'bbl' column, but has 'boroughid', 'block', 'lot'
const NYC_OPEN_DATA_BASE = 'https://data.cityofnewyork.us/resource/ygpa-z7cr.json';

// ============ Inline Shared Utilities ============

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

const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 10 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

async function fetchWithRetry(url: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; data?: unknown; error?: string; retryAfter?: number }> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return { ok: true, status: response.status, data: await response.json() };
      }
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
        return { ok: false, status: 429, error: 'Rate limit exceeded', retryAfter };
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

// ============ End Shared Utilities ============

interface HPDComplaintRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  raw: Record<string, unknown>;
}

interface ApiResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: HPDComplaintRecord[];
  nextOffset: number | null;
  requestId: string;
}

function validateBBL(bbl: string): boolean {
  return /^\d{10}$/.test(bbl);
}

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  try {
    if (dateStr.includes('T')) return new Date(dateStr).toISOString().split('T')[0];
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [month, day, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    if (/^\d{8}$/.test(dateStr)) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    return dateStr;
  } catch { return dateStr; }
}

function normalizeComplaint(raw: Record<string, unknown>): HPDComplaintRecord {
  // Dataset uses "status" field with values like "CLOSE" or "OPEN"
  const statusValue = (raw.status as string || '').toLowerCase();
  
  let status: 'open' | 'closed' | 'unknown' = 'unknown';
  if (statusValue.includes('close')) {
    status = 'closed';
  } else if (statusValue.includes('open')) {
    status = 'open';
  }

  // Build description from major/minor category
  const majorCategory = raw.majorcategory as string || '';
  const minorCategory = raw.minorcategory as string || '';
  const code = raw.code as string || '';
  const spaceType = raw.spacetype as string || '';
  
  let description = majorCategory;
  if (minorCategory && !description.includes(minorCategory)) {
    description = `${description} - ${minorCategory}`;
  }
  if (spaceType) {
    description = `[${spaceType}] ${description}`;
  }
  if (code) {
    description = `${description} (${code})`;
  }

  return {
    recordType: 'HPD Complaint',
    recordId: raw.complaintid as string || raw.problemid as string || 'Unknown',
    status,
    // Use statusdate as the primary date field (verified in schema)
    issueDate: parseDateToISO(raw.statusdate as string),
    resolvedDate: status === 'closed' ? parseDateToISO(raw.statusdate as string) : null,
    category: majorCategory || null,
    description: description || null,
    raw,
  };
}

// Parse BBL into components
function parseBBL(bbl: string): { boroughId: string; block: string; lot: string } {
  // BBL format: BBBBBLLLL (1 digit borough, 5 digit block, 4 digit lot)
  const boroughId = bbl.charAt(0);
  // Remove leading zeros for block and lot to match dataset format
  const block = parseInt(bbl.slice(1, 6), 10).toString();
  const lot = parseInt(bbl.slice(6, 10), 10).toString();
  return { boroughId, block, lot };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ctx = createRequestContext('hpd-complaints');
  const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

  try {
    // Check for required app token
    if (!NYC_OPEN_DATA_APP_TOKEN) {
      return createErrorResponse(ctx, 500, 'Configuration error', 'NYC_OPEN_DATA_APP_TOKEN is not configured', 
        'Server is missing NYC Open Data token configuration.');
    }

    const clientIP = getClientIP(req);
    const rateLimit = checkRateLimit(clientIP);
    if (!rateLimit.allowed) {
      logRequest(ctx, 'Rate limited', { ip: clientIP });
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
    for (const key of ['bbl', 'BBL', 'bblId', 'propertyBbl']) {
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

    // Parse BBL into components
    const { boroughId, block, lot } = parseBBL(bbl);

    let limit = parseInt(params.get('limit') || '50', 10);
    limit = Math.min(Math.max(1, limit), 200);
    let offset = parseInt(params.get('offset') || '0', 10);
    offset = Math.max(0, offset);

    const fromDate = params.get('fromDate');
    const toDate = params.get('toDate');
    const statusFilter = params.get('status') || 'all';
    const keyword = params.get('q');

    const cacheKey = `hpd-complaints:${bbl}:${limit}:${offset}:${statusFilter}:${fromDate || ''}:${toDate || ''}:${keyword || ''}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) {
      logRequest(ctx, 'Cache hit');
      return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build SoQL query using verified schema columns: boroughid, block, lot
    // Dataset ygpa-z7cr uses 'boroughid' (numeric: 1-5), 'block', 'lot'
    const whereConditions: string[] = [
      `boroughid='${boroughId}'`,
      `block='${block}'`,
      `lot='${lot}'`,
    ];
    
    // Use 'statusdate' which is a verified column in this dataset
    if (fromDate) whereConditions.push(`statusdate >= '${fromDate}'`);
    if (toDate) whereConditions.push(`statusdate <= '${toDate}'`);
    if (keyword) {
      whereConditions.push(`(upper(majorcategory) like upper('%${keyword.replace(/'/g, "''")}%') OR upper(minorcategory) like upper('%${keyword.replace(/'/g, "''")}%'))`);
    }

    const whereClause = whereConditions.join(' AND ');
    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    // Use statusdate for ordering (verified column)
    dataUrl.searchParams.set('$order', 'statusdate DESC NULLS LAST');

    const upstreamUrl = dataUrl.toString();
    
    // Log columns being used (diagnostic)
    logRequest(ctx, 'Building query with schema columns', { 
      columns: ['boroughid', 'block', 'lot', 'statusdate', 'majorcategory', 'minorcategory'],
      boroughId,
      block,
      lot,
      upstreamUrl
    });

    const headers: Record<string, string> = { 
      'Accept': 'application/json',
      'X-App-Token': NYC_OPEN_DATA_APP_TOKEN,
    };

    const result = await fetchWithRetry(upstreamUrl, { headers });

    // Log upstream response status
    logRequest(ctx, 'Upstream response', { 
      upstreamStatus: result.status,
      upstreamOk: result.ok 
    });

    if (!result.ok) {
      const upstreamStatus = result.status;
      
      // Pass through actual status codes
      if (upstreamStatus === 400) {
        return createErrorResponse(ctx, 400, 'Bad request', result.error || 'Upstream returned 400',
          'Invalid query to NYC Open Data. Please check your search parameters.', { service: 'NYC Open Data', status: 400 });
      }
      
      if (upstreamStatus === 403) {
        return createErrorResponse(ctx, 403, 'Access denied', result.error || 'Upstream returned 403',
          'Access to NYC Open Data was denied.', { service: 'NYC Open Data', status: 403 });
      }
      
      if (upstreamStatus === 404) {
        return createErrorResponse(ctx, 404, 'Not found', result.error || 'Upstream returned 404',
          'The requested data was not found on NYC Open Data.', { service: 'NYC Open Data', status: 404 });
      }
      
      if (upstreamStatus === 429) {
        return createErrorResponse(ctx, 429, 'Upstream rate limit', 'NYC Open Data rate limit exceeded', 
          'The NYC data service is busy. Please try again in a moment.', { service: 'NYC Open Data', status: 429 });
      }
      
      // For 5xx errors, use 502
      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown error',
        'Unable to retrieve HPD complaint data from NYC Open Data. Please try again later.', { service: 'NYC Open Data', status: upstreamStatus });
    }

    const rawData = result.data as Record<string, unknown>[];
    const hasMore = rawData.length > limit;
    const dataToProcess = hasMore ? rawData.slice(0, limit) : rawData;

    let items = dataToProcess.map(normalizeComplaint);
    if (statusFilter === 'open') items = items.filter(item => item.status === 'open');
    else if (statusFilter === 'closed') items = items.filter(item => item.status === 'closed');

    let totalApprox = items.length + offset;
    try {
      const countUrl = new URL(NYC_OPEN_DATA_BASE);
      countUrl.searchParams.set('$select', 'count(*)');
      countUrl.searchParams.set('$where', whereClause);
      const countResult = await fetchWithRetry(countUrl.toString(), { headers });
      if (countResult.ok && Array.isArray(countResult.data) && countResult.data[0]?.count) {
        totalApprox = parseInt(countResult.data[0].count, 10);
      }
    } catch { /* Use estimate */ }

    const response: ApiResponse = {
      source: 'HPD Complaints',
      bbl,
      totalApprox,
      items,
      nextOffset: hasMore ? offset + limit : null,
      requestId: ctx.requestId,
    };

    setCache(cacheKey, response);
    logRequest(ctx, 'Success', { itemCount: items.length, totalApprox });

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return createErrorResponse(ctx, 500, 'Internal server error', 
      error instanceof Error ? error.message : 'Unknown error',
      'An unexpected error occurred. Please try again.');
  }
});
