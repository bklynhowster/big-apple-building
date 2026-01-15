import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// In-memory cache with different TTLs based on result type
interface CacheEntry {
  data: unknown;
  timestamp: number;
  hasRows: boolean;
  cacheKey: string;
}
const cache = new Map<string, CacheEntry>();
const SUCCESS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours for successful responses with rows
const NO_DATA_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes for "no data found" responses

// NYC Open Data DOF Property Charges Balance dataset
const DATASET_ID = 'scjx-j6np';

// Raw row from NYC Open Data (can have any fields)
interface RawChargeRow {
  [key: string]: unknown;
}

// Normalized line item for the UI
interface LineItem {
  date: string | null;
  description: string | null;
  amount: number | null;
  balance: number | null;
  status: string | null;
}

interface Attempt {
  field: string;
  key: string;
  url: string;
  rows_found: number;
  error?: string;
}

type OwedStatus = 'paid' | 'due' | 'unknown';

interface TaxResult {
  current_amount_owed: number | null;
  owed_status: OwedStatus;
  owed_reason: string | null;
  rows_count: number;
  rows_with_numeric_balance: number;
  as_of: string | null;
  line_items: LineItem[];
  scope_used: 'unit' | 'building' | 'direct';
  bbl_used: string;
  matched_field: string | null;
  matched_key: string | null;
  no_data_found: boolean;
  data_source_used: string;
  cache_status: 'HIT' | 'MISS';
  cached_at: string | null;
  // Debug info (only included when debug=true)
  raw_rows?: RawChargeRow[];
  attempts?: Attempt[];
}

// Normalize BBL to proper format: 1 borough + 5 block (padded) + 4 lot (padded)
function normalizeBbl(bbl: string): string {
  if (!bbl || bbl.length < 5) return bbl;
  
  const cleaned = bbl.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    const borough = cleaned.charAt(0);
    const block = cleaned.slice(1, 6).padStart(5, '0');
    const lot = cleaned.slice(6, 10).padStart(4, '0');
    return `${borough}${block}${lot}`;
  }
  
  return cleaned.padStart(10, '0');
}

// Generate candidate keys from a BBL
function generateCandidateKeys(bbl: string): string[] {
  const candidates: string[] = [];
  
  const original = bbl.padStart(10, '0');
  candidates.push(original);
  candidates.push(original + '0');
  
  const normalized = normalizeBbl(bbl);
  if (normalized !== original) {
    candidates.push(normalized);
    candidates.push(normalized + '0');
  }
  
  return [...new Set(candidates)];
}

// Query NYC Open Data with a specific field and key
async function queryByFieldAndKey(
  field: string, 
  key: string, 
  appToken: string
): Promise<{ rows: RawChargeRow[]; url: string; error?: string }> {
  const whereClause = `${field}='${key}'`;
  const url = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json?$limit=200&$where=${encodeURIComponent(whereClause)}`;
  
  console.log(`[property-taxes] Query: ${field}='${key}' -> ${url}`);
  
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  
  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[property-taxes] API error for ${field}=${key}: ${response.status}`);
      return { rows: [], url, error: `API ${response.status}: ${errorBody.substring(0, 200)}` };
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      return { rows: [], url, error: 'Unexpected response format' };
    }
    
    console.log(`[property-taxes] ${field}='${key}' returned ${data.length} rows`);
    return { rows: data as RawChargeRow[], url };
    
  } catch (fetchError) {
    const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`[property-taxes] Fetch error: ${errMsg}`);
    return { rows: [], url, error: `Network error: ${errMsg}` };
  }
}

// Multi-key lookup
async function multiKeyLookup(
  bbl: string, 
  scope: 'unit' | 'building' | 'direct',
  appToken: string
): Promise<{ 
  rows: RawChargeRow[]; 
  matchedField: string | null;
  matchedKey: string | null;
  attempts: Attempt[];
  bblUsed: string;
}> {
  const attempts: Attempt[] = [];
  const candidateKeys = generateCandidateKeys(bbl);
  const fieldsToTry = ['parid', 'bble', 'bbl'];
  
  console.log(`[property-taxes] Multi-key lookup for BBL ${bbl}, scope: ${scope}`);
  
  for (const key of candidateKeys) {
    for (const field of fieldsToTry) {
      const result = await queryByFieldAndKey(field, key, appToken);
      
      attempts.push({
        field, key, url: result.url,
        rows_found: result.rows.length,
        error: result.error,
      });
      
      if (result.rows.length > 0) {
        console.log(`[property-taxes] ✓ Found ${result.rows.length} rows using ${field}='${key}'`);
        return { rows: result.rows, matchedField: field, matchedKey: key, attempts, bblUsed: bbl };
      }
    }
  }
  
  console.log(`[property-taxes] No rows found after ${attempts.length} attempts`);
  return { rows: [], matchedField: null, matchedKey: null, attempts, bblUsed: bbl };
}

// Get first non-empty string value from a row
function getFirstString(row: RawChargeRow, ...fields: string[]): string | null {
  for (const field of fields) {
    const val = row[field];
    if (val !== undefined && val !== null && val !== '') {
      const str = String(val).trim();
      if (str) return str;
    }
  }
  return null;
}

// Get first numeric value from a row
function getFirstNumber(row: RawChargeRow, ...fields: string[]): number | null {
  for (const field of fields) {
    const val = row[field];
    if (val !== undefined && val !== null && val !== '') {
      const num = parseFloat(String(val));
      if (!isNaN(num)) return num;
    }
  }
  return null;
}

// Normalize a raw row into a LineItem
function normalizeRow(raw: RawChargeRow): LineItem {
  return {
    date: getFirstString(raw, 
      'date', 'bill_date', 'effective_date', 'period', 'fiscal_year', 
      'stmtdate', 'activitythrough', 'bill_period', 'tax_year'
    ),
    description: getFirstString(raw, 
      'type', 'charge_type', 'charge_description', 'description', 'charge', 'tax_class',
      'chargetype', 'dession', 'install'
    ),
    amount: getFirstNumber(raw, 
      'amount', 'charge_amount', 'original_amount', 'billed_amount', 'value'
    ),
    balance: getFirstNumber(raw, 
      'open_balance', 'outstanding_amount', 'outstanding_balance', 'balance', 'amount_due'
    ),
    status: getFirstString(raw, 
      'status', 'charge_status', 'open_closed', 'payment_status'
    ),
  };
}

// Compute current amount owed from normalized line items
function computeAmountOwed(items: LineItem[]): { 
  amount: number | null; 
  rowsWithNumericBalance: number;
  reason: string | null;
} {
  let total = 0;
  let rowsWithNumericBalance = 0;
  
  for (const item of items) {
    if (item.balance !== null) {
      rowsWithNumericBalance++;
      total += item.balance;
    }
  }
  
  if (rowsWithNumericBalance === 0) {
    return { 
      amount: null, 
      rowsWithNumericBalance: 0,
      reason: 'No rows had a numeric balance value.'
    };
  }
  
  // Round to cents
  total = Math.round(total * 100) / 100;
  
  console.log(`[property-taxes] Computed balance: ${total} from ${rowsWithNumericBalance}/${items.length} items`);
  
  return { amount: total, rowsWithNumericBalance, reason: null };
}

// Determine owed status
function determineOwedStatus(
  rowsCount: number,
  rowsWithNumericBalance: number,
  currentAmountOwed: number | null
): OwedStatus {
  if (rowsCount === 0 || rowsWithNumericBalance === 0 || currentAmountOwed === null) {
    return 'unknown';
  }
  
  if (currentAmountOwed <= 0) return 'paid';
  return 'due';
}

// Get the most recent date from line items
function getAsOfDate(items: LineItem[]): string | null {
  let maxDate: string | null = null;
  
  for (const item of items) {
    if (item.date && (!maxDate || item.date > maxDate)) {
      maxDate = item.date;
    }
  }
  
  return maxDate;
}

// Process raw rows into normalized result
function processCharges(
  rawRows: RawChargeRow[], 
  scope: 'unit' | 'building' | 'direct', 
  matchedField: string | null,
  matchedKey: string | null,
  bblUsed: string,
  attempts: Attempt[],
  includeDebug: boolean
): Omit<TaxResult, 'cache_status' | 'cached_at'> {
  const dataSourceUsed = `NYC Open Data DOF Property Charges Balance (${DATASET_ID})`;
  
  if (rawRows.length === 0) {
    const baseResult: Omit<TaxResult, 'cache_status' | 'cached_at'> = {
      current_amount_owed: null,
      owed_status: 'unknown',
      owed_reason: 'No charge rows found for this parcel.',
      rows_count: 0,
      rows_with_numeric_balance: 0,
      as_of: null,
      line_items: [],
      scope_used: scope,
      bbl_used: bblUsed,
      matched_field: null,
      matched_key: null,
      no_data_found: true,
      data_source_used: dataSourceUsed,
    };
    if (includeDebug) {
      baseResult.raw_rows = [];
      baseResult.attempts = attempts;
    }
    return baseResult;
  }
  
  // Log available fields for debugging
  if (rawRows.length > 0) {
    const sampleFields = Object.keys(rawRows[0]);
    console.log(`[property-taxes] Available fields in raw rows: ${sampleFields.join(', ')}`);
  }
  
  // Normalize all rows
  const lineItems = rawRows.map(normalizeRow);
  
  // Sort by date descending (newest first)
  lineItems.sort((a, b) => {
    const dateA = a.date || '';
    const dateB = b.date || '';
    return dateB.localeCompare(dateA);
  });
  
  // Compute amount owed
  const { amount, rowsWithNumericBalance, reason } = computeAmountOwed(lineItems);
  
  // Determine owed status
  const owedStatus = determineOwedStatus(rawRows.length, rowsWithNumericBalance, amount);
  
  // Get as_of date
  const asOf = getAsOfDate(lineItems);
  
  console.log(`[property-taxes] Processed ${rawRows.length} rows -> ${lineItems.length} items, balance_rows: ${rowsWithNumericBalance}, amount: ${amount}, status: ${owedStatus}`);
  
  const result: Omit<TaxResult, 'cache_status' | 'cached_at'> = {
    current_amount_owed: amount,
    owed_status: owedStatus,
    owed_reason: reason,
    rows_count: rawRows.length,
    rows_with_numeric_balance: rowsWithNumericBalance,
    as_of: asOf,
    line_items: lineItems.slice(0, 25),
    scope_used: scope,
    bbl_used: bblUsed,
    matched_field: matchedField,
    matched_key: matchedKey,
    no_data_found: false,
    data_source_used: dataSourceUsed,
  };
  
  if (includeDebug) {
    result.raw_rows = rawRows.slice(0, 25);
    result.attempts = attempts;
  }
  
  return result;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const includeDebug = url.searchParams.get('debug') === 'true';
    
    const { bbl, building_bbl, view_bbl } = await req.json();
    
    const viewBbl = view_bbl || bbl;
    const buildingBbl = building_bbl;
    
    console.log(`[property-taxes] Request - view_bbl: ${viewBbl}, building_bbl: ${buildingBbl || 'none'}, debug: ${includeDebug}`);
    
    if (!viewBbl || viewBbl.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Invalid BBL format. Expected 10 digits.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    
    const normalizedViewBbl = normalizeBbl(viewBbl);
    const normalizedBuildingBbl = buildingBbl ? normalizeBbl(buildingBbl) : null;
    
    // Check cache
    const baseCacheKey = `v2:${normalizedViewBbl}:${normalizedBuildingBbl || ''}`;
    const cached = cache.get(baseCacheKey);
    
    if (cached) {
      const age = Date.now() - cached.timestamp;
      const ttl = cached.hasRows ? SUCCESS_CACHE_TTL_MS : NO_DATA_CACHE_TTL_MS;
      
      if (age < ttl) {
        console.log(`[property-taxes] Cache HIT for ${baseCacheKey}`);
        const cachedResult = {
          ...(cached.data as object),
          cache_status: 'HIT' as const,
          cached_at: new Date(cached.timestamp).toISOString(),
        };
        return new Response(
          JSON.stringify(cachedResult),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        cache.delete(baseCacheKey);
      }
    }
    
    // Try unit BBL first
    let lookupResult = await multiKeyLookup(normalizedViewBbl, buildingBbl ? 'unit' : 'direct', appToken);
    let allAttempts = lookupResult.attempts;
    let scope: 'unit' | 'building' | 'direct' = buildingBbl ? 'unit' : 'direct';
    
    // Fallback to building BBL
    if (lookupResult.rows.length === 0 && normalizedBuildingBbl && normalizedBuildingBbl !== normalizedViewBbl) {
      console.log(`[property-taxes] No rows for unit, trying building BBL: ${normalizedBuildingBbl}`);
      
      const buildingResult = await multiKeyLookup(normalizedBuildingBbl, 'building', appToken);
      allAttempts = [...allAttempts, ...buildingResult.attempts];
      
      if (buildingResult.rows.length > 0) {
        lookupResult = buildingResult;
        scope = 'building';
      }
    }
    
    // Process results
    const baseResult = processCharges(
      lookupResult.rows,
      scope,
      lookupResult.matchedField,
      lookupResult.matchedKey,
      scope === 'building' ? (normalizedBuildingBbl || normalizedViewBbl) : normalizedViewBbl,
      allAttempts,
      includeDebug
    );
    
    const now = Date.now();
    
    // Cache if no API errors or we have rows
    const hasApiError = allAttempts.some(a => a.error && a.rows_found === 0);
    const shouldCache = !hasApiError || baseResult.rows_count > 0;
    
    if (shouldCache) {
      cache.set(baseCacheKey, { 
        data: baseResult, 
        timestamp: now,
        hasRows: baseResult.rows_count > 0,
        cacheKey: baseCacheKey,
      });
    }
    
    const result: TaxResult = {
      ...baseResult,
      cache_status: 'MISS',
      cached_at: null,
    };
    
    console.log(`[property-taxes] Result - scope: ${result.scope_used}, amount: ${result.current_amount_owed}, status: ${result.owed_status}, items: ${result.line_items.length}`);
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch tax data';
    console.error('[property-taxes] Unhandled error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
