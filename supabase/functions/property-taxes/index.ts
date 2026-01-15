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

interface ChargeRow {
  parid?: string;
  bble?: string;
  bbl?: string;
  stmtdate?: string;
  activitythrough?: string;
  value?: string;
  balance?: string;
  open_balance?: string;
  outstanding?: string;
  dession?: string;
  chargetype?: string;
  install?: string;
  tax_year?: string;
  borough?: string;
  block?: string;
  lot?: string;
  period?: string;
  bill_period?: string;
  effective_date?: string;
  [key: string]: unknown;
}

interface Attempt {
  field: string;
  key: string;
  url: string;
  rows_found: number;
  error?: string;
}

type OwedStatus = 'paid' | 'due' | 'unknown';

interface BaseTaxResult {
  current_amount_owed: number | null;
  rows_count: number;
  rows_with_numeric_balance: number;
  as_of: string | null;
  recent_rows: ChargeRow[];
  scope_used: 'unit' | 'building' | 'direct';
  parid_used: string;
  bbl_used: string;
  matched_field: string | null;
  matched_key: string | null;
  no_data_found: boolean;
  attempts: Attempt[];
  api_error?: string;
  // New strict balance tracking
  balance_field_used: string | null;
  owed_status: OwedStatus;
  owed_reason: string | null;
  data_source_used: string;
}

interface TaxResult extends BaseTaxResult {
  cache_status: 'HIT' | 'MISS';
  cached_at: string | null;
}

// Normalize BBL to proper format: 1 borough + 5 block (padded) + 4 lot (padded)
function normalizeBbl(bbl: string): string {
  if (!bbl || bbl.length < 5) return bbl;
  
  // Try to parse as raw BBL
  const cleaned = bbl.replace(/\D/g, '');
  
  if (cleaned.length === 10) {
    // Already 10 digits, but ensure proper padding
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
  
  // Original BBL (10 digits)
  const original = bbl.padStart(10, '0');
  candidates.push(original);
  
  // BBLE variant (BBL + "0" for easement)
  candidates.push(original + '0');
  
  // Normalized version
  const normalized = normalizeBbl(bbl);
  if (normalized !== original) {
    candidates.push(normalized);
    candidates.push(normalized + '0');
  }
  
  // Deduplicate while preserving order
  return [...new Set(candidates)];
}

// Query NYC Open Data with a specific field and key
async function queryByFieldAndKey(
  field: string, 
  key: string, 
  appToken: string
): Promise<{ rows: ChargeRow[]; url: string; error?: string }> {
  // Use $where with equality for precise matching
  const whereClause = `${field}='${key}'`;
  const url = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json?$limit=200&$where=${encodeURIComponent(whereClause)}`;
  
  console.log(`[property-taxes] Query: ${field}='${key}' -> ${url}`);
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  
  if (appToken) {
    headers['X-App-Token'] = appToken;
  }
  
  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[property-taxes] API error for ${field}=${key}: ${response.status}`);
      console.error(`[property-taxes] Error body: ${errorBody.substring(0, 300)}`);
      return { 
        rows: [], 
        url,
        error: `API ${response.status}: ${errorBody.substring(0, 200)}` 
      };
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      console.error(`[property-taxes] Unexpected response type: ${typeof data}`);
      return { rows: [], url, error: 'Unexpected response format' };
    }
    
    console.log(`[property-taxes] ${field}='${key}' returned ${data.length} rows`);
    return { rows: data as ChargeRow[], url };
    
  } catch (fetchError) {
    const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`[property-taxes] Fetch error: ${errMsg}`);
    return { rows: [], url, error: `Network error: ${errMsg}` };
  }
}

// Multi-key lookup: try all combinations until we find rows
async function multiKeyLookup(
  bbl: string, 
  scope: 'unit' | 'building' | 'direct',
  appToken: string
): Promise<{ 
  rows: ChargeRow[]; 
  matchedField: string | null;
  matchedKey: string | null;
  attempts: Attempt[];
  bblUsed: string;
}> {
  const attempts: Attempt[] = [];
  const candidateKeys = generateCandidateKeys(bbl);
  const fieldsToTry = ['parid', 'bble', 'bbl'];
  
  console.log(`[property-taxes] Multi-key lookup for BBL ${bbl}, scope: ${scope}`);
  console.log(`[property-taxes] Candidate keys: ${candidateKeys.join(', ')}`);
  
  // Try each candidate key with each field
  for (const key of candidateKeys) {
    for (const field of fieldsToTry) {
      const result = await queryByFieldAndKey(field, key, appToken);
      
      const attempt: Attempt = {
        field,
        key,
        url: result.url,
        rows_found: result.rows.length,
        error: result.error,
      };
      attempts.push(attempt);
      
      if (result.rows.length > 0) {
        console.log(`[property-taxes] ✓ Found ${result.rows.length} rows using ${field}='${key}'`);
        return {
          rows: result.rows,
          matchedField: field,
          matchedKey: key,
          attempts,
          bblUsed: bbl,
        };
      }
    }
  }
  
  console.log(`[property-taxes] No rows found after ${attempts.length} attempts`);
  return {
    rows: [],
    matchedField: null,
    matchedKey: null,
    attempts,
    bblUsed: bbl,
  };
}

// Priority list of balance-like fields
const BALANCE_FIELD_PRIORITY = [
  'open_balance',
  'outstanding_balance',
  'outstanding_amount',
  'balance',
  'amount_due',
];

// Find the best balance field from the rows
function findBalanceField(rows: ChargeRow[]): string | null {
  if (rows.length === 0) return null;
  
  const sampleRow = rows[0];
  const availableFields = Object.keys(sampleRow);
  console.log(`[property-taxes] Available fields in rows: ${availableFields.join(', ')}`);
  
  // Check priority list first
  for (const field of BALANCE_FIELD_PRIORITY) {
    if (availableFields.includes(field)) {
      const hasValue = rows.some(r => r[field] !== undefined && r[field] !== null && r[field] !== '');
      if (hasValue) {
        console.log(`[property-taxes] Found priority balance field: ${field}`);
        return field;
      }
    }
  }
  
  // Fallback: find any field containing 'balance' or 'outstanding' (case-insensitive)
  const balancePattern = /balance|outstanding/i;
  for (const field of availableFields) {
    if (balancePattern.test(field)) {
      const hasValue = rows.some(r => r[field] !== undefined && r[field] !== null && r[field] !== '');
      if (hasValue) {
        console.log(`[property-taxes] Found fallback balance field: ${field}`);
        return field;
      }
    }
  }
  
  console.log(`[property-taxes] No balance-like field found in: ${availableFields.join(', ')}`);
  return null;
}

// Compute current amount owed with strict numeric parsing
function computeAmountOwed(rows: ChargeRow[], balanceField: string | null): { 
  amount: number | null; 
  rowsWithNumericBalance: number;
  reason: string | null;
} {
  // If no balance field, we can't compute
  if (!balanceField) {
    return { 
      amount: null, 
      rowsWithNumericBalance: 0,
      reason: 'No balance/outstanding field found in NYC Open Data rows.'
    };
  }
  
  let total = 0;
  let rowsWithNumericBalance = 0;
  
  for (const row of rows) {
    const rawValue = row[balanceField];
    
    // Skip null, undefined, empty
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      continue;
    }
    
    const numValue = parseFloat(String(rawValue));
    
    // Skip NaN
    if (isNaN(numValue)) {
      continue;
    }
    
    rowsWithNumericBalance++;
    total += numValue;
  }
  
  // If no rows had numeric balance, treat as unknown
  if (rowsWithNumericBalance === 0) {
    return { 
      amount: null, 
      rowsWithNumericBalance: 0,
      reason: 'No rows had a numeric balance value.'
    };
  }
  
  // Round to cents
  total = Math.round(total * 100) / 100;
  
  console.log(`[property-taxes] Computed balance: ${total} from ${rowsWithNumericBalance}/${rows.length} rows using field '${balanceField}'`);
  
  return { 
    amount: total, 
    rowsWithNumericBalance,
    reason: null
  };
}

// Determine owed status based on strict rules
function determineOwedStatus(
  rowsCount: number,
  balanceFieldUsed: string | null,
  rowsWithNumericBalance: number,
  currentAmountOwed: number | null
): OwedStatus {
  // Must have rows, a balance field, and numeric values to determine paid/due
  if (rowsCount === 0 || !balanceFieldUsed || rowsWithNumericBalance === 0 || currentAmountOwed === null) {
    return 'unknown';
  }
  
  if (currentAmountOwed === 0) {
    return 'paid';
  }
  
  if (currentAmountOwed > 0) {
    return 'due';
  }
  
  // Negative balance (credit) - still treat as paid
  return 'paid';
}

// Get the most recent date from rows
function getAsOfDate(rows: ChargeRow[]): string | null {
  const dateFields = ['activitythrough', 'stmtdate', 'period', 'bill_period', 'effective_date'];
  
  let maxDate: string | null = null;
  
  for (const row of rows) {
    for (const field of dateFields) {
      const val = row[field];
      if (val && typeof val === 'string' && val.trim()) {
        if (!maxDate || val > maxDate) {
          maxDate = val;
        }
      }
    }
  }
  
  return maxDate;
}

// Process charge rows into a summary
function processCharges(
  rows: ChargeRow[], 
  scope: 'unit' | 'building' | 'direct', 
  matchedField: string | null,
  matchedKey: string | null,
  bblUsed: string,
  attempts: Attempt[]
): BaseTaxResult {
  const dataSourceUsed = `NYC Open Data DOF Property Charges Balance (${DATASET_ID})`;
  
  // If no rows, return explicit "no data found"
  if (rows.length === 0) {
    return {
      current_amount_owed: null,
      rows_count: 0,
      rows_with_numeric_balance: 0,
      as_of: null,
      recent_rows: [],
      scope_used: scope,
      parid_used: matchedKey || '',
      bbl_used: bblUsed,
      matched_field: null,
      matched_key: null,
      no_data_found: true,
      attempts,
      balance_field_used: null,
      owed_status: 'unknown',
      owed_reason: 'No charge rows found for this parcel.',
      data_source_used: dataSourceUsed,
    };
  }
  
  // Find balance field
  const balanceFieldUsed = findBalanceField(rows);
  
  // Compute amount owed with strict parsing
  const { amount, rowsWithNumericBalance, reason } = computeAmountOwed(rows, balanceFieldUsed);
  
  // Determine owed status
  const owedStatus = determineOwedStatus(rows.length, balanceFieldUsed, rowsWithNumericBalance, amount);
  
  // Get as_of date
  const asOf = getAsOfDate(rows);
  
  // Sort rows by date descending
  const sortedRows = [...rows].sort((a, b) => {
    const dateA = a.stmtdate || a.activitythrough || '';
    const dateB = b.stmtdate || b.activitythrough || '';
    return dateB.localeCompare(dateA);
  });
  
  console.log(`[property-taxes] Processed ${rows.length} rows, balance_field: ${balanceFieldUsed}, numeric_rows: ${rowsWithNumericBalance}, amount: ${amount}, status: ${owedStatus}`);
  
  return {
    current_amount_owed: amount,
    rows_count: rows.length,
    rows_with_numeric_balance: rowsWithNumericBalance,
    as_of: asOf,
    recent_rows: sortedRows.slice(0, 25),
    scope_used: scope,
    parid_used: matchedKey || '',
    bbl_used: bblUsed,
    matched_field: matchedField,
    matched_key: matchedKey,
    no_data_found: false,
    attempts,
    balance_field_used: balanceFieldUsed,
    owed_status: owedStatus,
    owed_reason: reason,
    data_source_used: dataSourceUsed,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bbl, building_bbl, view_bbl } = await req.json();
    
    // Accept either bbl or view_bbl
    const viewBbl = view_bbl || bbl;
    const buildingBbl = building_bbl;
    
    console.log(`[property-taxes] Request - view_bbl: ${viewBbl}, building_bbl: ${buildingBbl || 'none'}`);
    
    if (!viewBbl || viewBbl.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Invalid BBL format. Expected 10 digits.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    
    // Normalize the BBLs
    const normalizedViewBbl = normalizeBbl(viewBbl);
    const normalizedBuildingBbl = buildingBbl ? normalizeBbl(buildingBbl) : null;
    
    // Check cache with appropriate TTL based on result type
    const baseCacheKey = `multikey:${normalizedViewBbl}:${normalizedBuildingBbl || ''}`;
    const cached = cache.get(baseCacheKey);
    
    if (cached) {
      const age = Date.now() - cached.timestamp;
      const ttl = cached.hasRows ? SUCCESS_CACHE_TTL_MS : NO_DATA_CACHE_TTL_MS;
      
      if (age < ttl) {
        console.log(`[property-taxes] Cache HIT for ${baseCacheKey} (hasRows: ${cached.hasRows}, age: ${Math.round(age / 1000)}s)`);
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
        console.log(`[property-taxes] Cache expired for ${baseCacheKey} (hasRows: ${cached.hasRows}, age: ${Math.round(age / 1000)}s, ttl: ${ttl / 1000}s)`);
        cache.delete(baseCacheKey);
      }
    }
    
    // Try unit BBL first (multi-key lookup)
    let lookupResult = await multiKeyLookup(normalizedViewBbl, buildingBbl ? 'unit' : 'direct', appToken);
    let allAttempts = lookupResult.attempts;
    let scope: 'unit' | 'building' | 'direct' = buildingBbl ? 'unit' : 'direct';
    
    // If no rows and we have a building BBL, try building BBL
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
      allAttempts
    );
    
    // Build final cache key including match details for precision
    const finalCacheKey = baseResult.rows_count > 0 
      ? `${baseCacheKey}:${baseResult.matched_field}:${baseResult.matched_key}:${baseResult.scope_used}`
      : baseCacheKey;
    
    const now = Date.now();
    
    // Only cache successful responses (no API errors in attempts that we relied on)
    const hasApiError = baseResult.attempts.some(a => a.error && a.rows_found === 0);
    const shouldCache = !hasApiError || baseResult.rows_count > 0;
    
    if (shouldCache) {
      cache.set(baseCacheKey, { 
        data: baseResult, 
        timestamp: now,
        hasRows: baseResult.rows_count > 0,
        cacheKey: finalCacheKey,
      });
      console.log(`[property-taxes] Cached result (hasRows: ${baseResult.rows_count > 0}, key: ${baseCacheKey})`);
    } else {
      console.log(`[property-taxes] NOT caching due to API errors`);
    }
    
    // Add cache status to response
    const result = {
      ...baseResult,
      cache_status: 'MISS' as const,
      cached_at: null,
    };
    
    console.log(`[property-taxes] Result - scope: ${result.scope_used}, matched: ${result.matched_field}='${result.matched_key}', amount: ${result.current_amount_owed}, rows: ${result.rows_count}, no_data: ${result.no_data_found}`);
    
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
