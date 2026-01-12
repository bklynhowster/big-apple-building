import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data HPD Complaints and Problems dataset
const DATASET_ID = 'ygpa-z7cr';
const NYC_OPEN_DATA_BASE = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`;

// ============ Schema Guard ============

// Candidate columns we'd like to use (in priority order for each purpose)
const CANDIDATE_COLUMNS = {
  id: ['complaintid', 'complaint_id', 'problemid', 'problem_id', 'unique_key'],
  bbl: ['bbl'],
  date: ['receiveddate', 'received_date', 'statusdate', 'status_date'],
  status: ['complaintstatus', 'complaint_status', 'problemstatus', 'problem_status', 'status', 'statusdescription'],
  category: ['complainttype', 'complaint_type', 'majorcat', 'majorcategory'],
  description: ['problemdescription', 'problem_description', 'minorcat', 'minorcategory', 'spacetype', 'space_type'],
  location: ['housenumber', 'house_number', 'streetname', 'street_name', 'apartment', 'postcode', 'zip'],
};

// Minimal safe columns if schema discovery fails
const MINIMAL_SAFE_COLUMNS = ['bbl', 'unique_key'];

// 24-hour schema cache
const schemaCache = new Map<string, { columns: Set<string>; expiresAt: number }>();
const SCHEMA_CACHE_TTL = 24 * 60 * 60 * 1000;

interface SchemaInfo {
  columns: Set<string>;
  bblColumn: string | null;
  dateColumn: string | null;
  idColumn: string | null;
}

async function discoverSchema(appToken: string): Promise<SchemaInfo> {
  const cacheKey = `schema:${DATASET_ID}`;
  const cached = schemaCache.get(cacheKey);
  
  if (cached && cached.expiresAt > Date.now()) {
    return buildSchemaInfo(cached.columns);
  }

  try {
    // Probe with $limit=1 to discover columns
    const probeUrl = new URL(NYC_OPEN_DATA_BASE);
    probeUrl.searchParams.set('$limit', '1');
    
    const response = await fetch(probeUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-App-Token': appToken,
      },
    });

    if (!response.ok) {
      console.log(`Schema discovery failed with status ${response.status}, using minimal columns`);
      return buildSchemaInfo(new Set(MINIMAL_SAFE_COLUMNS));
    }

    const data = await response.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      // Empty dataset - try metadata endpoint instead
      const metaUrl = `https://data.cityofnewyork.us/api/views/${DATASET_ID}.json`;
      const metaResponse = await fetch(metaUrl, {
        headers: { 'X-App-Token': appToken },
      });
      
      if (metaResponse.ok) {
        const meta = await metaResponse.json();
        if (meta.columns && Array.isArray(meta.columns)) {
          const columns = new Set<string>(meta.columns.map((c: { fieldName: string }) => c.fieldName.toLowerCase()));
          schemaCache.set(cacheKey, { columns, expiresAt: Date.now() + SCHEMA_CACHE_TTL });
          console.log(`Schema discovered via metadata: ${Array.from(columns).join(', ')}`);
          return buildSchemaInfo(columns);
        }
      }
      
      return buildSchemaInfo(new Set(MINIMAL_SAFE_COLUMNS));
    }

    // Extract column names from first row
    const columns = new Set<string>(Object.keys(data[0]).map(k => k.toLowerCase()));
    schemaCache.set(cacheKey, { columns, expiresAt: Date.now() + SCHEMA_CACHE_TTL });
    console.log(`Schema discovered: ${Array.from(columns).slice(0, 20).join(', ')}${columns.size > 20 ? '...' : ''}`);
    
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

  return {
    columns,
    bblColumn: findFirst(CANDIDATE_COLUMNS.bbl),
    dateColumn: findFirst(CANDIDATE_COLUMNS.date),
    idColumn: findFirst(CANDIDATE_COLUMNS.id),
  };
}

function getConfirmedColumns(schema: SchemaInfo): string[] {
  const confirmed: string[] = [];
  
  // Add all candidate columns that exist in schema
  for (const candidates of Object.values(CANDIDATE_COLUMNS)) {
    for (const col of candidates) {
      if (schema.columns.has(col) && !confirmed.includes(col)) {
        confirmed.push(col);
      }
    }
  }
  
  return confirmed;
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
const RESPONSE_CACHE_TTL = 10 * 60 * 1000;

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

// ============ Record Processing ============

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
  schemaInfo?: { dateColumn: string | null; idColumn: string | null };
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

function normalizeComplaint(raw: Record<string, unknown>, schema: SchemaInfo): HPDComplaintRecord {
  // Try multiple possible status fields from confirmed columns
  const statusFields = ['complaintstatus', 'complaint_status', 'problemstatus', 'problem_status', 'status', 'statusdescription'];
  let statusValue = '';
  for (const field of statusFields) {
    if (schema.columns.has(field) && raw[field]) {
      statusValue = String(raw[field]).toLowerCase();
      break;
    }
  }
  
  let status: 'open' | 'closed' | 'unknown' = 'unknown';
  if (statusValue.includes('close')) {
    status = 'closed';
  } else if (statusValue.includes('open') || statusValue.includes('pending')) {
    status = 'open';
  }

  // Build description from available fields
  const descFields = ['problemdescription', 'problem_description', 'complainttype', 'complaint_type', 'minorcat', 'spacetype'];
  let description = '';
  for (const field of descFields) {
    if (schema.columns.has(field) && raw[field]) {
      const val = String(raw[field]);
      if (!description) {
        description = val;
      } else if (!description.includes(val)) {
        description = `${description} - ${val}`;
      }
    }
  }

  // Get category
  const catFields = ['complainttype', 'complaint_type', 'majorcat', 'majorcategory'];
  let category = '';
  for (const field of catFields) {
    if (schema.columns.has(field) && raw[field]) {
      category = String(raw[field]);
      break;
    }
  }

  // Get record ID
  let recordId = 'Unknown';
  if (schema.idColumn && raw[schema.idColumn]) {
    recordId = String(raw[schema.idColumn]);
  }

  // Get dates
  let issueDate: string | null = null;
  if (schema.dateColumn && raw[schema.dateColumn]) {
    issueDate = parseDateToISO(String(raw[schema.dateColumn]));
  }

  return {
    recordType: 'HPD Complaint',
    recordId,
    status,
    issueDate,
    resolvedDate: status === 'closed' ? issueDate : null,
    category: category || null,
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

    // Discover schema first
    const schema = await discoverSchema(NYC_OPEN_DATA_APP_TOKEN);
    const confirmedColumns = getConfirmedColumns(schema);
    
    logRequest(ctx, 'Schema discovered', { 
      bblColumn: schema.bblColumn,
      dateColumn: schema.dateColumn,
      idColumn: schema.idColumn,
      confirmedCount: confirmedColumns.length
    });

    // Validate that BBL column exists
    if (!schema.bblColumn) {
      return createErrorResponse(ctx, 400, 'Schema mismatch', 'Dataset does not have a bbl column',
        'Unable to query this dataset - schema mismatch prevented.');
    }

    // Build SoQL query using ONLY confirmed columns
    const whereClause = `${schema.bblColumn}='${bbl}'`;
    
    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    
    // Only add ORDER BY if we have a confirmed date column
    if (schema.dateColumn) {
      dataUrl.searchParams.set('$order', `${schema.dateColumn} DESC NULL LAST`);
    }

    const upstreamUrl = dataUrl.toString();
    
    logRequest(ctx, 'SoQL query built', { 
      whereClause,
      orderBy: schema.dateColumn || 'none',
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
      
      // Return 400 for upstream 400s (schema mismatch, bad query)
      if (upstreamStatus === 400) {
        return createErrorResponse(ctx, 400, 'Invalid query', result.error || 'Upstream returned 400',
          'Invalid query—schema mismatch prevented.', { service: 'NYC Open Data', status: 400 });
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

    const items = dataToProcess.map(row => normalizeComplaint(row, schema));

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
      schemaInfo: { dateColumn: schema.dateColumn, idColumn: schema.idColumn },
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
