import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data DOB Violations dataset
const NYC_OPEN_DATA_BASE = 'https://data.cityofnewyork.us/resource/3h2n-5cm9.json';
const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

// ============ Inline Shared Utilities ============

// Generate unique request ID
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

// Simple in-memory rate limiter
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

// Simple in-memory cache
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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

// Fetch with retry for 5xx only
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

interface ViolationRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'resolved' | 'unknown';
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
  items: ViolationRecord[];
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

function normalizeViolation(raw: Record<string, unknown>): ViolationRecord {
  const dispositionDate = parseDateToISO(raw.disposition_date as string);
  const dispositionComments = (raw.disposition_comments as string || '').toLowerCase();
  
  let status: 'open' | 'resolved' | 'unknown' = 'unknown';
  if (dispositionDate) {
    if (dispositionComments.includes('dismissed') || dispositionComments.includes('complied') || 
        dispositionComments.includes('resolved') || dispositionComments.includes('vacated') || 
        dispositionComments.includes('cured')) {
      status = 'resolved';
    } else if (dispositionComments.includes('pending') || dispositionComments.includes('open')) {
      status = 'open';
    } else {
      status = 'resolved';
    }
  } else {
    status = 'open';
  }

  return {
    recordType: 'Violation',
    recordId: raw.violation_number as string || raw.isn_dob_bis_viol as string || 'Unknown',
    status,
    issueDate: parseDateToISO(raw.issue_date as string),
    resolvedDate: dispositionDate,
    category: raw.violation_type_code as string || null,
    description: raw.description as string || null,
    raw,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ctx = createRequestContext('dob-violations');

  try {
    // Rate limiting
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

    // Extract BBL
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

    const boro = bbl.charAt(0);
    const block = bbl.slice(1, 6);
    const lot = bbl.slice(6, 10);

    let limit = parseInt(params.get('limit') || '50', 10);
    limit = Math.min(Math.max(1, limit), 200);
    let offset = parseInt(params.get('offset') || '0', 10);
    offset = Math.max(0, offset);

    const fromDate = params.get('fromDate');
    const toDate = params.get('toDate');
    const status = params.get('status') || 'all';
    const keyword = params.get('q');

    // Build cache key
    const cacheKey = `violations:${bbl}:${limit}:${offset}:${status}:${fromDate || ''}:${toDate || ''}:${keyword || ''}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) {
      logRequest(ctx, 'Cache hit');
      return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    logRequest(ctx, 'Fetching from NYC Open Data', { boro, block, lot });

    // Build SoQL query
    const whereConditions: string[] = [
      `boro='${boro}'`,
      `block='${block.replace(/^0+/, '') || '0'}'`,
      `lot='${lot.replace(/^0+/, '') || '0'}'`,
    ];
    if (fromDate) whereConditions.push(`issue_date >= '${fromDate}'`);
    if (toDate) whereConditions.push(`issue_date <= '${toDate}'`);
    if (keyword) whereConditions.push(`upper(description) like upper('%${keyword.replace(/'/g, "''")}%')`);

    const whereClause = whereConditions.join(' AND ');
    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    dataUrl.searchParams.set('$order', 'issue_date DESC');

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (NYC_OPEN_DATA_APP_TOKEN) headers['X-App-Token'] = NYC_OPEN_DATA_APP_TOKEN;

    const result = await fetchWithRetry(dataUrl.toString(), { headers });

    if (!result.ok) {
      if (result.status === 429) {
        return createErrorResponse(ctx, 429, 'Upstream rate limit', 'NYC Open Data rate limit exceeded', 
          'The NYC data service is busy. Please try again in a moment.', { service: 'NYC Open Data', status: 429 });
      }
      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown error',
        'Unable to retrieve data from NYC Open Data. Please try again later.', { service: 'NYC Open Data', status: result.status });
    }

    const rawData = result.data as Record<string, unknown>[];
    const hasMore = rawData.length > limit;
    const dataToProcess = hasMore ? rawData.slice(0, limit) : rawData;

    let items = dataToProcess.map(normalizeViolation);
    if (status === 'open') items = items.filter(item => item.status === 'open');
    else if (status === 'resolved') items = items.filter(item => item.status === 'resolved');

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
      source: 'DOB Violations',
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