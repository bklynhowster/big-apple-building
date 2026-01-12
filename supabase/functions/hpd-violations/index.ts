import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data HPD Housing Maintenance Code Violations dataset
const DATASET_ID = 'wvxf-dwi5';
const NYC_OPEN_DATA_BASE = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`;
const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

// ============ Schema Guard ============

// Candidate columns we'd like to use (in priority order for each purpose)
const CANDIDATE_COLUMNS = {
  id: ['violationid', 'violation_id', 'unique_key'],
  bbl: ['bbl'],
  boroBlockLot: ['boroid', 'boro_id', 'borough', 'block', 'lot'],
  date: ['inspectiondate', 'inspection_date', 'novissueddate', 'nov_issued_date', 'approveddate', 'certifieddate'],
  status: ['currentstatus', 'current_status', 'violationstatus', 'violation_status'],
  statusDate: ['currentstatusdate', 'current_status_date', 'statusdate'],
  category: ['class', 'violationclass', 'violation_class'],
  description: ['novdescription', 'nov_description', 'ordernumber', 'order_number'],
  location: ['apartment', 'apt', 'story', 'housenumber', 'house_number', 'streetname', 'street_name', 'postcode', 'zip'],
};

// Minimal safe columns if schema discovery fails
const MINIMAL_SAFE_COLUMNS = ['violationid', 'unique_key'];

// 24-hour schema cache
const schemaCache = new Map<string, { columns: Set<string>; expiresAt: number }>();
const SCHEMA_CACHE_TTL = 24 * 60 * 60 * 1000;

interface SchemaInfo {
  columns: Set<string>;
  bblColumn: string | null;
  boroColumn: string | null;
  blockColumn: string | null;
  lotColumn: string | null;
  dateColumn: string | null;
  idColumn: string | null;
  statusColumn: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
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
    boroColumn: findFirst(['boroid', 'boro_id', 'borough']),
    blockColumn: findFirst(['block']),
    lotColumn: findFirst(['lot']),
    dateColumn: findFirst(CANDIDATE_COLUMNS.date),
    idColumn: findFirst(CANDIDATE_COLUMNS.id),
    statusColumn: findFirst(CANDIDATE_COLUMNS.status),
    classColumn: findFirst(CANDIDATE_COLUMNS.category),
    descriptionColumn: findFirst(CANDIDATE_COLUMNS.description),
  };
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

// ============ Record Processing ============

interface HPDViolationRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  violationClass: string | null;
  raw: Record<string, unknown>;
}

interface ApiResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: HPDViolationRecord[];
  nextOffset: number | null;
  requestId: string;
  schemaInfo?: { filterMethod: string; dateColumn: string | null };
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

function normalizeViolation(raw: Record<string, unknown>, schema: SchemaInfo): HPDViolationRecord {
  // Get status from confirmed columns
  let statusValue = '';
  if (schema.statusColumn && raw[schema.statusColumn]) {
    statusValue = String(raw[schema.statusColumn]).toLowerCase();
  }
  
  let status: 'open' | 'closed' | 'unknown' = 'unknown';
  if (statusValue.includes('close') || statusValue.includes('dismissed')) {
    status = 'closed';
  } else if (statusValue.includes('open') || !statusValue) {
    status = 'open';
  }

  // Get description from confirmed columns
  let description = '';
  const descFields = ['novdescription', 'nov_description', 'ordernumber', 'order_number'];
  for (const field of descFields) {
    if (schema.columns.has(field) && raw[field]) {
      const val = String(raw[field]);
      if (!description) {
        description = val;
      } else if (!description.includes(val)) {
        description = `${val}: ${description}`;
      }
    }
  }
  
  // Add apartment if available
  if (schema.columns.has('apartment') && raw.apartment) {
    description = `[Apt ${raw.apartment}] ${description}`;
  }

  // Get violation class
  let violationClass: string | null = null;
  if (schema.classColumn && raw[schema.classColumn]) {
    violationClass = String(raw[schema.classColumn]);
  }

  // Get record ID
  let recordId = 'Unknown';
  if (schema.idColumn && raw[schema.idColumn]) {
    recordId = String(raw[schema.idColumn]);
  }

  // Get dates from confirmed columns
  let issueDate: string | null = null;
  const dateFields = ['inspectiondate', 'inspection_date', 'novissueddate', 'nov_issued_date'];
  for (const field of dateFields) {
    if (schema.columns.has(field) && raw[field]) {
      issueDate = parseDateToISO(String(raw[field]));
      break;
    }
  }

  let resolvedDate: string | null = null;
  if (status === 'closed') {
    const statusDateFields = ['currentstatusdate', 'current_status_date', 'statusdate'];
    for (const field of statusDateFields) {
      if (schema.columns.has(field) && raw[field]) {
        resolvedDate = parseDateToISO(String(raw[field]));
        break;
      }
    }
  }

  return {
    recordType: 'HPD Violation',
    recordId,
    status,
    issueDate,
    resolvedDate,
    category: violationClass,
    description: description || null,
    violationClass,
    raw,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const ctx = createRequestContext('hpd-violations');

  try {
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

    let limit = parseInt(params.get('limit') || '50', 10);
    limit = Math.min(Math.max(1, limit), 200);
    let offset = parseInt(params.get('offset') || '0', 10);
    offset = Math.max(0, offset);

    const fromDate = params.get('fromDate');
    const toDate = params.get('toDate');
    const statusFilter = params.get('status') || 'all';
    const violationClass = params.get('class');
    const keyword = params.get('q');

    const cacheKey = `hpd-violations:${bbl}:${limit}:${offset}:${statusFilter}:${violationClass || ''}:${fromDate || ''}:${toDate || ''}:${keyword || ''}`;
    const cached = getCached<ApiResponse>(cacheKey);
    if (cached) {
      logRequest(ctx, 'Cache hit');
      return new Response(JSON.stringify({ ...cached, requestId: ctx.requestId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Discover schema first
    const schema = await discoverSchema(NYC_OPEN_DATA_APP_TOKEN);
    
    logRequest(ctx, 'Schema discovered', { 
      bblColumn: schema.bblColumn,
      boroColumn: schema.boroColumn,
      blockColumn: schema.blockColumn,
      lotColumn: schema.lotColumn,
      dateColumn: schema.dateColumn,
      idColumn: schema.idColumn,
    });

    // Build WHERE clause - prefer BBL, fallback to boro/block/lot if BBL doesn't exist
    let whereConditions: string[] = [];
    let filterMethod = 'unknown';

    if (schema.bblColumn) {
      // BBL-first filtering (preferred)
      whereConditions.push(`${schema.bblColumn}='${bbl}'`);
      filterMethod = 'bbl';
    } else if (schema.boroColumn && schema.blockColumn && schema.lotColumn) {
      // Fallback to boro/block/lot
      const boroId = bbl.charAt(0);
      const block = parseInt(bbl.slice(1, 6), 10).toString();
      const lot = parseInt(bbl.slice(6, 10), 10).toString();
      
      whereConditions.push(`${schema.boroColumn}='${boroId}'`);
      whereConditions.push(`${schema.blockColumn}='${block}'`);
      whereConditions.push(`${schema.lotColumn}='${lot}'`);
      filterMethod = 'boro_block_lot';
    } else {
      return createErrorResponse(ctx, 400, 'Schema mismatch', 'Dataset does not have required filter columns (bbl or boroid/block/lot)',
        'Unable to query this dataset—schema mismatch prevented.');
    }

    // Add optional filters using only confirmed columns
    if (fromDate && schema.dateColumn) {
      whereConditions.push(`${schema.dateColumn} >= '${fromDate}'`);
    }
    if (toDate && schema.dateColumn) {
      whereConditions.push(`${schema.dateColumn} <= '${toDate}'`);
    }
    if (violationClass && schema.classColumn) {
      whereConditions.push(`${schema.classColumn}='${violationClass}'`);
    }
    if (keyword && schema.descriptionColumn) {
      whereConditions.push(`upper(${schema.descriptionColumn}) like upper('%${keyword.replace(/'/g, "''")}%')`);
    }

    const whereClause = whereConditions.join(' AND ');
    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    
    // Only add ORDER BY if we have a confirmed date column
    if (schema.dateColumn) {
      dataUrl.searchParams.set('$order', `${schema.dateColumn} DESC`);
    }

    logRequest(ctx, 'SoQL query built', { 
      filterMethod,
      whereClause,
      orderBy: schema.dateColumn || 'none',
    });

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (NYC_OPEN_DATA_APP_TOKEN) headers['X-App-Token'] = NYC_OPEN_DATA_APP_TOKEN;

    const result = await fetchWithRetry(dataUrl.toString(), { headers });

    if (!result.ok) {
      const upstreamStatus = result.status;
      
      // Return 400 for upstream 400s (schema mismatch, bad query)
      if (upstreamStatus === 400) {
        return createErrorResponse(ctx, 400, 'Invalid query', result.error || 'Upstream returned 400',
          'Invalid query—schema mismatch prevented.', { service: 'NYC Open Data', status: 400 });
      }
      if (result.status === 429) {
        return createErrorResponse(ctx, 429, 'Upstream rate limit', 'NYC Open Data rate limit exceeded', 
          'The NYC data service is busy. Please try again in a moment.', { service: 'NYC Open Data', status: 429 });
      }
      return createErrorResponse(ctx, 502, 'Upstream error', result.error || 'Unknown error',
        'Unable to retrieve HPD data from NYC Open Data. Please try again later.', { service: 'NYC Open Data', status: result.status });
    }

    const rawData = result.data as Record<string, unknown>[];
    const hasMore = rawData.length > limit;
    const dataToProcess = hasMore ? rawData.slice(0, limit) : rawData;

    let items = dataToProcess.map(row => normalizeViolation(row, schema));
    
    // Filter by status if specified (client-side since status values vary)
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
      source: 'HPD Violations',
      bbl,
      totalApprox,
      items,
      nextOffset: hasMore ? offset + limit : null,
      requestId: ctx.requestId,
      schemaInfo: { filterMethod, dateColumn: schema.dateColumn },
    };

    setCache(cacheKey, response);
    logRequest(ctx, 'Success', { itemCount: items.length, totalApprox, filterMethod });

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return createErrorResponse(ctx, 500, 'Internal server error', 
      error instanceof Error ? error.message : 'Unknown error',
      'An unexpected error occurred. Please try again.');
  }
});
