import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NYC_OPEN_DATA_BASE = 'https://data.cityofnewyork.us/resource/6bgk-3dad.json';
const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

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

interface ECBRecord { recordType: string; recordId: string; status: 'open' | 'resolved' | 'unknown'; issueDate: string | null; resolvedDate: string | null; category: string | null; description: string | null; penaltyAmount: number | null; amountPaid: number | null; balanceDue: number | null; severity: string | null; raw: Record<string, unknown>; }
interface ApiResponse { source: string; bbl: string; totalApprox: number; items: ECBRecord[]; nextOffset: number | null; requestId: string; }

function validateBBL(bbl: string): boolean { return /^\d{10}$/.test(bbl); }

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  try {
    if (/^\d{8}$/.test(dateStr)) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    if (dateStr.includes('T')) return new Date(dateStr).toISOString().split('T')[0];
    const parts = dateStr.split('/'); if (parts.length === 3) { const [m, d, y] = parts; return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; }
    return dateStr;
  } catch { return dateStr; }
}

function normalizeECBViolation(raw: Record<string, unknown>): ECBRecord {
  const ecbStatus = (raw.ecb_violation_status as string || '').toUpperCase();
  const hearingStatus = (raw.hearing_status as string || '').toUpperCase();
  let status: 'open' | 'resolved' | 'unknown' = 'unknown';
  if (ecbStatus === 'RESOLVE' || ecbStatus === 'RESOLVED') status = 'resolved';
  else if (ecbStatus === 'OPEN' || ecbStatus === 'ACTIVE') status = 'open';
  else if (hearingStatus.includes('VIOLATION') || hearingStatus.includes('DEFAULT')) {
    status = parseFloat(raw.balance_due as string || '0') > 0 ? 'open' : 'resolved';
  } else if (hearingStatus.includes('DISMISSED')) status = 'resolved';

  const penaltyImposed = raw.penality_imposed || raw.penalty_imposed;
  return {
    recordType: 'ECB', recordId: raw.ecb_violation_number as string || raw.dob_violation_number as string || 'Unknown',
    status, issueDate: parseDateToISO(raw.issue_date as string), resolvedDate: null,
    category: raw.violation_type as string || raw.infraction_code1 as string || null,
    description: raw.violation_description as string || raw.section_law_description1 as string || null,
    penaltyAmount: penaltyImposed ? parseFloat(penaltyImposed as string) : null,
    amountPaid: raw.amount_paid ? parseFloat(raw.amount_paid as string) : null,
    balanceDue: raw.balance_due ? parseFloat(raw.balance_due as string) : null,
    severity: raw.severity as string || null, raw,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ctx = createRequestContext('dob-ecb');

  try {
    const clientIP = getClientIP(req);
    const rateLimit = checkRateLimit(clientIP);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded', details: `Wait ${rateLimit.retryAfter}s`, userMessage: 'Too many requests. Please wait.', requestId: ctx.requestId }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(rateLimit.retryAfter) } });
    }

    const url = new URL(req.url);
    let bbl = url.searchParams.get('bbl');
    if (!bbl) return createErrorResponse(ctx, 400, 'Missing parameter', 'bbl required', 'Please provide a valid property identifier.');

    bbl = bbl.padStart(10, '0'); ctx.bbl = bbl;
    if (!validateBBL(bbl)) return createErrorResponse(ctx, 400, 'Invalid BBL', 'bbl must be 10 digits', 'The property identifier format is invalid.');

    const boro = bbl.charAt(0), block = bbl.slice(1, 6), lot = bbl.slice(6, 10);
    let limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)), 200);
    let offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
    const fromDate = url.searchParams.get('fromDate'), toDate = url.searchParams.get('toDate');
    const status = url.searchParams.get('status') || 'all', keyword = url.searchParams.get('q');

    const cacheKey = `ecb:${bbl}:${limit}:${offset}:${status}:${fromDate || ''}:${toDate || ''}:${keyword || ''}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) { logRequest(ctx, 'Cache hit'); return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

    logRequest(ctx, 'Fetching from NYC Open Data', { boro, block, lot });

    const whereConditions: string[] = [`boro='${boro}'`, `block='${block}'`, `lot='${lot}'`];
    if (fromDate) whereConditions.push(`issue_date >= '${fromDate.replace(/-/g, '')}'`);
    if (toDate) whereConditions.push(`issue_date <= '${toDate.replace(/-/g, '')}'`);
    if (status === 'open') whereConditions.push(`(ecb_violation_status='ACTIVE' OR ecb_violation_status='OPEN' OR balance_due > 0)`);
    else if (status === 'resolved') whereConditions.push(`ecb_violation_status='RESOLVE'`);
    if (keyword) whereConditions.push(`upper(violation_description) like upper('%${keyword.replace(/'/g, "''")}%')`);

    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereConditions.join(' AND '));
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    dataUrl.searchParams.set('$order', 'issue_date DESC');

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (NYC_OPEN_DATA_APP_TOKEN) headers['X-App-Token'] = NYC_OPEN_DATA_APP_TOKEN;

    const result = await fetchWithRetry(dataUrl.toString(), { headers });
    if (!result.ok) {
      if (result.status === 429) return createErrorResponse(ctx, 429, 'Upstream rate limit', 'NYC Open Data rate limit', 'The NYC data service is busy. Please try again.', { service: 'NYC Open Data', status: 429 });
      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown', 'Unable to retrieve ECB data. Please try again.', { service: 'NYC Open Data', status: result.status });
    }

    const rawData = result.data as Record<string, unknown>[];
    const hasMore = rawData.length > limit;
    const items = (hasMore ? rawData.slice(0, limit) : rawData).map(normalizeECBViolation);

    let totalApprox = items.length + offset;
    try {
      const countUrl = new URL(NYC_OPEN_DATA_BASE);
      countUrl.searchParams.set('$select', 'count(*)');
      countUrl.searchParams.set('$where', whereConditions.join(' AND '));
      const countResult = await fetchWithRetry(countUrl.toString(), { headers });
      if (countResult.ok && Array.isArray(countResult.data) && countResult.data[0]?.count) totalApprox = parseInt(countResult.data[0].count, 10);
    } catch { /* estimate */ }

    const response: ApiResponse = { source: 'DOB ECB Violations', bbl, totalApprox, items, nextOffset: hasMore ? offset + limit : null, requestId: ctx.requestId };
    setCache(cacheKey, response);
    logRequest(ctx, 'Success', { itemCount: items.length });

    return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return createErrorResponse(ctx, 500, 'Internal server error', error instanceof Error ? error.message : 'Unknown', 'An unexpected error occurred.');
  }
});