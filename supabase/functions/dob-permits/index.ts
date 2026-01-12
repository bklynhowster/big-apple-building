import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NYC_OPEN_DATA_BASE = 'https://data.cityofnewyork.us/resource/ipu4-2q9a.json';
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

interface PermitRecord {
  recordType: string; recordId: string; status: 'open' | 'closed' | 'unknown';
  issueDate: string | null; resolvedDate: string | null; expirationDate: string | null;
  category: string | null; description: string | null; jobNumber: string | null;
  permitType: string | null; workType: string | null; applicantName: string | null; ownerName: string | null;
  raw: Record<string, unknown>;
}

interface ApiResponse { source: string; bbl: string; totalApprox: number; items: PermitRecord[]; nextOffset: number | null; requestId: string; }

function validateBBL(bbl: string): boolean { return /^\d{10}$/.test(bbl); }

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  try {
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) { const [m, d, y] = parts; return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; }
    }
    if (dateStr.includes('T') || dateStr.includes('-')) return new Date(dateStr).toISOString().split('T')[0];
    if (/^\d{8}$/.test(dateStr)) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    return dateStr;
  } catch { return dateStr; }
}

const boroughNames: Record<string, string> = { '1': 'MANHATTAN', '2': 'BRONX', '3': 'BROOKLYN', '4': 'QUEENS', '5': 'STATEN ISLAND' };

function normalizePermit(raw: Record<string, unknown>): PermitRecord {
  const permitStatus = (raw.permit_status as string || '').toUpperCase();
  let status: 'open' | 'closed' | 'unknown' = 'unknown';
  if (['ISSUED', 'IN PROCESS', 'PENDING'].includes(permitStatus)) status = 'open';
  else if (['SIGNED OFF', 'COMPLETED', 'EXPIRED'].includes(permitStatus)) status = 'closed';

  const permitteeBiz = raw.permittee_s_business_name as string || '';
  const permitteeFirst = raw.permittee_s_first_name as string || '';
  const permitteeLast = raw.permittee_s_last_name as string || '';
  const applicantName = permitteeBiz || `${permitteeFirst} ${permitteeLast}`.trim() || null;

  const ownerBiz = raw.owner_s_business_name as string || '';
  const ownerFirst = raw.owner_s_first_name as string || '';
  const ownerLast = raw.owner_s_last_name as string || '';
  const ownerName = ownerBiz || `${ownerFirst} ${ownerLast}`.trim() || null;

  const workType = raw.work_type as string || '';
  const jobType = raw.job_type as string || '';
  const permitType = raw.permit_type as string || '';

  return {
    recordType: 'Permit', recordId: raw.job__ as string || raw.permit_si_no as string || 'Unknown',
    status, issueDate: parseDateToISO(raw.issuance_date as string), resolvedDate: null,
    expirationDate: parseDateToISO(raw.expiration_date as string),
    category: permitType || jobType || null, description: [workType, jobType].filter(Boolean).join(' - ') || null,
    jobNumber: raw.job__ as string || null, permitType: permitType || null, workType: workType || null,
    applicantName, ownerName, raw,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const ctx = createRequestContext('dob-permits');

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
    const boroughName = boroughNames[boro] || 'MANHATTAN';
    const paddedLot = lot.padStart(5, '0');

    let limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)), 200);
    let offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
    const fromDate = url.searchParams.get('fromDate'), toDate = url.searchParams.get('toDate');
    const status = url.searchParams.get('status') || 'all', keyword = url.searchParams.get('q');

    const cacheKey = `permits:${bbl}:${limit}:${offset}:${status}:${fromDate || ''}:${toDate || ''}:${keyword || ''}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) { logRequest(ctx, 'Cache hit'); return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

    logRequest(ctx, 'Fetching from NYC Open Data', { borough: boroughName, block, lot: paddedLot });

    const whereConditions: string[] = [`borough='${boroughName}'`, `block='${block}'`, `lot='${paddedLot}'`];
    if (fromDate) whereConditions.push(`issuance_date >= '${fromDate}'`);
    if (toDate) whereConditions.push(`issuance_date <= '${toDate}'`);
    if (status === 'open') whereConditions.push(`(permit_status='ISSUED' OR permit_status='IN PROCESS' OR permit_status='PENDING')`);
    else if (status === 'closed') whereConditions.push(`(permit_status='SIGNED OFF' OR permit_status='COMPLETED' OR permit_status='EXPIRED')`);
    if (keyword) {
      const ek = keyword.replace(/'/g, "''");
      whereConditions.push(`(upper(permit_type) like upper('%${ek}%') OR upper(work_type) like upper('%${ek}%') OR upper(job_type) like upper('%${ek}%'))`);
    }

    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereConditions.join(' AND '));
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    dataUrl.searchParams.set('$order', 'issuance_date DESC');

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (NYC_OPEN_DATA_APP_TOKEN) headers['X-App-Token'] = NYC_OPEN_DATA_APP_TOKEN;

    const result = await fetchWithRetry(dataUrl.toString(), { headers });
    if (!result.ok) {
      if (result.status === 429) return createErrorResponse(ctx, 429, 'Upstream rate limit', 'NYC Open Data rate limit', 'The NYC data service is busy. Please try again.', { service: 'NYC Open Data', status: 429 });
      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown', 'Unable to retrieve permit data. Please try again.', { service: 'NYC Open Data', status: result.status });
    }

    const rawData = result.data as Record<string, unknown>[];
    const hasMore = rawData.length > limit;
    const items = (hasMore ? rawData.slice(0, limit) : rawData).map(normalizePermit);

    let totalApprox = items.length + offset;
    try {
      const countUrl = new URL(NYC_OPEN_DATA_BASE);
      countUrl.searchParams.set('$select', 'count(*)');
      countUrl.searchParams.set('$where', whereConditions.join(' AND '));
      const countResult = await fetchWithRetry(countUrl.toString(), { headers });
      if (countResult.ok && Array.isArray(countResult.data) && countResult.data[0]?.count) totalApprox = parseInt(countResult.data[0].count, 10);
    } catch { /* estimate */ }

    const response: ApiResponse = { source: 'DOB Permits', bbl, totalApprox, items, nextOffset: hasMore ? offset + limit : null, requestId: ctx.requestId };
    setCache(cacheKey, response);
    logRequest(ctx, 'Success', { itemCount: items.length });

    return new Response(JSON.stringify(response), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return createErrorResponse(ctx, 500, 'Internal server error', error instanceof Error ? error.message : 'Unknown', 'An unexpected error occurred.');
  }
});