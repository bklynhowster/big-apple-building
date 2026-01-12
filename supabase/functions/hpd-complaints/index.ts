import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data HPD Complaints and Problems dataset (ygpa-z7cr)
// Using BBL-only filtering - no derived borough/block/lot
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
    return dateStr;
  } catch { return dateStr; }
}

function normalizeComplaint(raw: Record<string, unknown>): HPDComplaintRecord {
  // Try multiple possible status fields
  const status1 = (raw.complaintstatus as string || '').toLowerCase();
  const status2 = (raw.problemstatus as string || '').toLowerCase();
  const statusDesc = (raw.statusdescription as string || '').toLowerCase();
  const statusAny = status1 || status2 || statusDesc;
  
  let status: 'open' | 'closed' | 'unknown' = 'unknown';
  if (statusAny.includes('close')) {
    status = 'closed';
  } else if (statusAny.includes('open') || statusAny.includes('pending')) {
    status = 'open';
  }

  // Build description from available fields
  const problemDesc = raw.problemdescription as string || '';
  const complaintType = raw.complainttype as string || '';
  const spaceType = raw.spacetype as string || '';
  
  let description = problemDesc || complaintType || '';
  if (spaceType && !description.includes(spaceType)) {
    description = `[${spaceType}] ${description}`;
  }

  return {
    recordType: 'HPD Complaint',
    recordId: raw.complaintid as string || raw.problemid as string || raw.unique_key as string || 'Unknown',
    status,
    issueDate: parseDateToISO(raw.received_date as string) || parseDateToISO(raw.receiveddate as string),
    resolvedDate: status === 'closed' ? parseDateToISO(raw.statusdate as string) : null,
    category: complaintType || null,
    description: description || null,
    raw,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ctx = createRequestContext('hpd-complaints');
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

    let limit = parseInt(params.get('limit') || '50', 10);
    limit = Math.min(Math.max(1, limit), 200);
    let offset = parseInt(params.get('offset') || '0', 10);
    offset = Math.max(0, offset);

    const cacheKey = `hpd-complaints:${bbl}:${limit}:${offset}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) {
      logRequest(ctx, 'Cache hit');
      return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // BBL-ONLY FILTER - no borough/block/lot derivation
    const whereClause = `bbl='${bbl}'`;
    
    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    // Use received_date for ordering (common HPD field name)
    dataUrl.searchParams.set('$order', 'received_date DESC NULL LAST');

    const upstreamUrl = dataUrl.toString();
    
    // DIAGNOSTIC: Log final SoQL and columns used
    logRequest(ctx, 'SoQL query built', { 
      whereClause,
      columnsUsed: ['bbl', 'received_date'],
      upstreamUrl
    });

    const headers: Record<string, string> = { 
      'Accept': 'application/json',
      'X-App-Token': NYC_OPEN_DATA_APP_TOKEN,
    };

    const result = await fetchWithRetry(upstreamUrl, { headers });

    logRequest(ctx, 'Upstream response', { upstreamStatus: result.status, upstreamOk: result.ok });

    if (!result.ok) {
      const upstreamStatus = result.status;
      
      if (upstreamStatus === 400) {
        return createErrorResponse(ctx, 400, 'Bad request', result.error || 'Upstream returned 400',
          'Invalid query to NYC Open Data.', { service: 'NYC Open Data', status: 400 });
      }
      if (upstreamStatus === 403) {
        return createErrorResponse(ctx, 403, 'Access denied', result.error || 'Upstream returned 403',
          'Access denied.', { service: 'NYC Open Data', status: 403 });
      }
      if (upstreamStatus === 429) {
        return createErrorResponse(ctx, 429, 'Rate limited', 'Upstream rate limited',
          'NYC data service is busy.', { service: 'NYC Open Data', status: 429 });
      }
      
      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown error',
        'Unable to retrieve HPD data.', { service: 'NYC Open Data', status: upstreamStatus });
    }

    const rawData = result.data as Record<string, unknown>[];
    const hasMore = rawData.length > limit;
    const dataToProcess = hasMore ? rawData.slice(0, limit) : rawData;

    const items = dataToProcess.map(normalizeComplaint);

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
      'An unexpected error occurred.');
  }
});
