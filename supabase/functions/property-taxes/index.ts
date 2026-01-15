import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// In-memory cache with 6-hour TTL
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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

interface TaxResult {
  current_amount_owed: number | null;
  rows_count: number;
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

// Compute current amount owed from rows
function computeAmountOwed(rows: ChargeRow[]): { amount: number; balanceField: string } {
  // Look for balance-like fields in priority order
  const balanceFields = ['open_balance', 'balance', 'outstanding', 'value'];
  
  // Log available fields from first row for debugging
  if (rows.length > 0) {
    const sampleRow = rows[0];
    const availableFields = Object.keys(sampleRow);
    console.log(`[property-taxes] Available fields in rows: ${availableFields.join(', ')}`);
  }
  
  // Try to find the best balance field
  let usedField = 'value'; // default fallback
  let total = 0;
  
  for (const field of balanceFields) {
    const hasField = rows.some(r => r[field] !== undefined && r[field] !== null && r[field] !== '');
    if (hasField) {
      usedField = field;
      break;
    }
  }
  
  console.log(`[property-taxes] Using field '${usedField}' for balance calculation`);
  
  // Sum the values
  for (const row of rows) {
    const rawValue = row[usedField];
    if (rawValue !== undefined && rawValue !== null) {
      const numValue = parseFloat(String(rawValue));
      if (!isNaN(numValue)) {
        total += numValue;
      }
    }
  }
  
  // Round to cents
  total = Math.round(total * 100) / 100;
  
  return { amount: total, balanceField: usedField };
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
): TaxResult {
  // If no rows, return explicit "no data found"
  if (rows.length === 0) {
    return {
      current_amount_owed: null,
      rows_count: 0,
      as_of: null,
      recent_rows: [],
      scope_used: scope,
      parid_used: matchedKey || '',
      bbl_used: bblUsed,
      matched_field: null,
      matched_key: null,
      no_data_found: true,
      attempts,
    };
  }
  
  // Compute amount owed
  const { amount, balanceField } = computeAmountOwed(rows);
  
  // Get as_of date
  const asOf = getAsOfDate(rows);
  
  // Sort rows by date descending
  const sortedRows = [...rows].sort((a, b) => {
    const dateA = a.stmtdate || a.activitythrough || '';
    const dateB = b.stmtdate || b.activitythrough || '';
    return dateB.localeCompare(dateA);
  });
  
  console.log(`[property-taxes] Processed ${rows.length} rows using ${balanceField}, computed balance: ${amount}, as_of: ${asOf}`);
  
  return {
    current_amount_owed: amount,
    rows_count: rows.length,
    as_of: asOf,
    recent_rows: sortedRows.slice(0, 25),
    scope_used: scope,
    parid_used: matchedKey || '',
    bbl_used: bblUsed,
    matched_field: matchedField,
    matched_key: matchedKey,
    no_data_found: false,
    attempts,
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
    
    // Check cache
    const cacheKey = `multikey:${normalizedViewBbl}:${normalizedBuildingBbl || ''}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[property-taxes] Cache hit for ${cacheKey}`);
      return new Response(
        JSON.stringify(cached.data),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
    const result = processCharges(
      lookupResult.rows,
      scope,
      lookupResult.matchedField,
      lookupResult.matchedKey,
      scope === 'building' ? (normalizedBuildingBbl || normalizedViewBbl) : normalizedViewBbl,
      allAttempts
    );
    
    // Cache the result
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    
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
