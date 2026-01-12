import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DATASET_ID = '3h2n-5cm9';
const BASE_URL = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`;

// ============ Inline Shared Utilities ============
function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
}

interface RequestContext { requestId: string; endpoint: string; bbl?: string; startTime: number; }

function createRequestContext(endpoint: string, bbl?: string): RequestContext {
  return { requestId: generateRequestId(), endpoint, bbl, startTime: Date.now() };
}

function logRequest(ctx: RequestContext, message: string, extra?: Record<string, unknown>) {
  console.log(JSON.stringify({ requestId: ctx.requestId, endpoint: ctx.endpoint, bbl: ctx.bbl, durationMs: Date.now() - ctx.startTime, message, ...extra }));
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

const cache = new Map<string, { data: unknown; expiresAt: number }>();
function getCached<T>(key: string): T | null {
  const entry = cache.get(key); if (!entry || entry.expiresAt < Date.now()) { if (entry) cache.delete(key); return null; } return entry.data as T;
}
function setCache<T>(key: string, data: T): void { cache.set(key, { data, expiresAt: Date.now() + 10 * 60 * 1000 }); }

async function fetchWithRetry(url: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; data?: unknown; error?: string; retryAfter?: number }> {
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return { ok: true, status: response.status, data: await response.json() };
      if (response.status === 429) return { ok: false, status: 429, error: 'Rate limit exceeded', retryAfter: parseInt(response.headers.get('retry-after') || '60', 10) };
      if (response.status >= 500 && attempt < 1) { await new Promise(r => setTimeout(r, 250)); continue; }
      return { ok: false, status: response.status, error: await response.text() };
    } catch (error) { if (attempt < 1) { await new Promise(r => setTimeout(r, 250)); continue; } return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) }; }
  }
  return { ok: false, status: 0, error: 'All retry attempts failed' };
}
// ============ End Shared Utilities ============

interface SafetyViolation {
  recordType: 'Safety';
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  raw: Record<string, unknown>;
}

interface ApiResponse { source: string; bbl: string; totalApprox: number; items: SafetyViolation[]; nextOffset: number | null; requestId: string; }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ctx = createRequestContext('dob-safety');

  try {
    const clientIP = getClientIP(req);
    const rateLimit = checkRateLimit(clientIP);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded', details: `Wait ${rateLimit.retryAfter}s`, userMessage: 'Too many requests. Please wait.', requestId: ctx.requestId }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfter) } });
    }

    const url = new URL(req.url);
    const bbl = url.searchParams.get('bbl');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const fromDate = url.searchParams.get('fromDate');
    const toDate = url.searchParams.get('toDate');
    const status = url.searchParams.get('status') || 'all';

    if (!bbl || bbl.length !== 10) {
      return createErrorResponse(ctx, 400, 'Invalid BBL', 'Valid 10-digit BBL is required', 'Please provide a valid property identifier.');
    }

    ctx.bbl = bbl;
    const boro = bbl.charAt(0), block = bbl.slice(1, 6), lot = bbl.slice(6, 10);

    const cacheKey = `safety:${bbl}:${limit}:${offset}:${status}:${fromDate || ''}:${toDate || ''}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) { logRequest(ctx, 'Cache hit'); return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

    logRequest(ctx, 'Fetching safety data', { boro, block, lot });

    const whereClauses: string[] = [
      `boro = '${boro}'`, `block = '${block}'`, `lot = '${lot}'`,
      `(violation_category LIKE '%SAFETY%' OR violation_category LIKE '%HAZARD%' OR violation_category LIKE '%UNSAFE%' OR violation_type LIKE '%SAFETY%' OR violation_type LIKE '%HAZARD%')`,
    ];
    if (fromDate) whereClauses.push(`issue_date >= '${fromDate}T00:00:00'`);
    if (toDate) whereClauses.push(`issue_date <= '${toDate}T23:59:59'`);
    if (status === 'open') whereClauses.push(`disposition_date IS NULL`);
    else if (status === 'closed') whereClauses.push(`disposition_date IS NOT NULL`);

    const whereClause = whereClauses.join(' AND ');
    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (appToken) headers['X-App-Token'] = appToken;

    const dataUrl = `${BASE_URL}?$where=${encodeURIComponent(whereClause)}&$order=issue_date DESC&$limit=${limit}&$offset=${offset}`;
    const result = await fetchWithRetry(dataUrl, { headers });

    if (!result.ok) {
      if (result.status === 429) return createErrorResponse(ctx, 429, 'Upstream rate limit', 'NYC Open Data rate limit', 'The NYC data service is busy. Please try again.', { service: 'NYC Open Data', status: 429 });
      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown', 'Unable to retrieve safety data. Please try again.', { service: 'NYC Open Data', status: result.status });
    }

    const rawData = result.data as Record<string, unknown>[];
    const items: SafetyViolation[] = rawData.map((row) => {
      const dispositionDate = row.disposition_date as string | null;
      return {
        recordType: 'Safety' as const,
        recordId: (row.violation_number as string) || (row.number as string) || `${row.isn_dob_bis_viol || 'unknown'}`,
        status: dispositionDate ? 'closed' : 'open',
        issueDate: (row.issue_date as string) || null,
        resolvedDate: dispositionDate || null,
        category: (row.violation_category as string) || (row.violation_type as string) || null,
        description: (row.description as string) || (row.violation_type_code as string) || null,
        raw: row,
      };
    });

    let totalApprox = items.length;
    try {
      const countUrl = `${BASE_URL}?$where=${encodeURIComponent(whereClause)}&$select=count(*) as total`;
      const countResult = await fetchWithRetry(countUrl, { headers });
      if (countResult.ok && Array.isArray(countResult.data) && countResult.data[0]?.total) {
        totalApprox = parseInt(countResult.data[0].total);
      }
    } catch { /* use items length */ }

    const response: ApiResponse = {
      source: 'DOB Safety Violations', bbl, totalApprox, items,
      nextOffset: items.length === limit ? offset + limit : null, requestId: ctx.requestId,
    };
    setCache(cacheKey, response);
    logRequest(ctx, 'Success', { itemCount: items.length });

    return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return createErrorResponse(ctx, 500, 'Internal server error', error instanceof Error ? error.message : 'Unknown', 'An unexpected error occurred.');
  }
});