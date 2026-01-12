import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data 311 Service Requests (2020 to Present)
const NYC_OPEN_DATA_BASE = 'https://data.cityofnewyork.us/resource/erm2-nwe9.json';
const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

// ============ Inline Shared Utilities ============

function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

interface RequestContext {
  requestId: string;
  endpoint: string;
  lat?: number;
  lon?: number;
  startTime: number;
}

function createRequestContext(endpoint: string): RequestContext {
  return { requestId: generateRequestId(), endpoint, startTime: Date.now() };
}

function logRequest(ctx: RequestContext, message: string, extra?: Record<string, unknown>) {
  const duration = Date.now() - ctx.startTime;
  console.log(JSON.stringify({ requestId: ctx.requestId, endpoint: ctx.endpoint, lat: ctx.lat, lon: ctx.lon, durationMs: duration, message, ...extra }));
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

interface ServiceRequestRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  agency: string | null;
  raw: Record<string, unknown>;
}

interface ApiResponse {
  source: string;
  lat: number;
  lon: number;
  radiusMeters: number;
  totalApprox: number;
  items: ServiceRequestRecord[];
  nextOffset: number | null;
  requestId: string;
}

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  try {
    if (dateStr.includes('T')) return new Date(dateStr).toISOString().split('T')[0];
    return dateStr;
  } catch { return dateStr; }
}

function normalizeServiceRequest(raw: Record<string, unknown>): ServiceRequestRecord {
  const statusValue = (raw.status as string || '').toLowerCase();
  
  let status: 'open' | 'closed' | 'unknown' = 'unknown';
  if (statusValue.includes('closed')) {
    status = 'closed';
  } else if (statusValue.includes('open') || statusValue.includes('pending') || statusValue.includes('assigned')) {
    status = 'open';
  }

  // Build description from descriptor, location type, and incident address
  const descriptor = raw.descriptor as string || '';
  const locationType = raw.location_type as string || '';
  const incidentAddress = raw.incident_address as string || '';
  
  let description = descriptor || raw.complaint_type as string || '';
  if (locationType && !description.includes(locationType)) {
    description = `[${locationType}] ${description}`;
  }
  if (incidentAddress) {
    description = `${description} @ ${incidentAddress}`;
  }

  return {
    recordType: '311',
    recordId: raw.unique_key as string || 'Unknown',
    status,
    issueDate: parseDateToISO(raw.created_date as string),
    resolvedDate: parseDateToISO(raw.closed_date as string),
    category: raw.complaint_type as string || null,
    description: description || null,
    agency: raw.agency as string || null,
    raw,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ctx = createRequestContext('311-requests');

  try {
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

    // Get latitude and longitude
    const latStr = params.get('lat');
    const lonStr = params.get('lon');
    
    if (!latStr || !lonStr) {
      return createErrorResponse(ctx, 400, 'Missing parameters', 'lat and lon parameters are required', 'Please provide valid coordinates (latitude and longitude).');
    }

    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return createErrorResponse(ctx, 400, 'Invalid coordinates', 'lat must be -90 to 90, lon must be -180 to 180', 'The provided coordinates are invalid.');
    }

    ctx.lat = lat;
    ctx.lon = lon;

    // Radius in meters (default 250, max 1000)
    let radiusMeters = parseInt(params.get('radiusMeters') || '250', 10);
    radiusMeters = Math.min(Math.max(50, radiusMeters), 1000);

    // Date range (default 90 days back)
    const now = new Date();
    const defaultFromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const fromDate = params.get('fromDate') || defaultFromDate.toISOString().split('T')[0];
    const toDate = params.get('toDate');

    let limit = parseInt(params.get('limit') || '100', 10);
    limit = Math.min(Math.max(1, limit), 200);
    let offset = parseInt(params.get('offset') || '0', 10);
    offset = Math.max(0, offset);

    const status = params.get('status') || 'all';
    const keyword = params.get('q');

    const cacheKey = `311:${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusMeters}:${limit}:${offset}:${status}:${fromDate}:${toDate || ''}:${keyword || ''}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) {
      logRequest(ctx, 'Cache hit');
      return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    logRequest(ctx, 'Fetching from NYC Open Data 311', { lat, lon, radiusMeters });

    // Build SoQL query with within_circle geo filter
    // Socrata uses within_circle(location_column, lat, lon, radius_in_meters)
    const whereConditions: string[] = [
      `within_circle(location, ${lat}, ${lon}, ${radiusMeters})`,
      `created_date >= '${fromDate}'`,
    ];
    if (toDate) whereConditions.push(`created_date <= '${toDate}'`);
    if (keyword) whereConditions.push(`upper(complaint_type) like upper('%${keyword.replace(/'/g, "''")}%') OR upper(descriptor) like upper('%${keyword.replace(/'/g, "''")}%')`);

    const whereClause = whereConditions.join(' AND ');
    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    dataUrl.searchParams.set('$order', 'created_date DESC');

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (NYC_OPEN_DATA_APP_TOKEN) headers['X-App-Token'] = NYC_OPEN_DATA_APP_TOKEN;

    const result = await fetchWithRetry(dataUrl.toString(), { headers });

    if (!result.ok) {
      if (result.status === 429) {
        return createErrorResponse(ctx, 429, 'Upstream rate limit', 'NYC Open Data rate limit exceeded', 
          'The NYC data service is busy. Please try again in a moment.', { service: 'NYC Open Data', status: 429 });
      }
      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown error',
        'Unable to retrieve 311 data from NYC Open Data. Please try again later.', { service: 'NYC Open Data', status: result.status });
    }

    const rawData = result.data as Record<string, unknown>[];
    const hasMore = rawData.length > limit;
    const dataToProcess = hasMore ? rawData.slice(0, limit) : rawData;

    let items = dataToProcess.map(normalizeServiceRequest);
    if (status === 'open') items = items.filter(item => item.status === 'open');
    else if (status === 'closed') items = items.filter(item => item.status === 'closed');

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
      source: '311 Service Requests',
      lat,
      lon,
      radiusMeters,
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
