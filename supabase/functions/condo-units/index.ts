import "https://deno.land/x/xhr@0.3.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Digital Tax Map: Condominium Units dataset (the specific dataset requested)
const CONDO_UNITS_DATASET_ID = 'eguu-7ie3';
// NYC PLUTO dataset for property info / condo detection
const PLUTO_DATASET_ID = '64uk-42ks';

// Schema cache
const schemaCache = new Map<string, { columns: Set<string>; timestamp: number }>();
const SCHEMA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Response cache
const responseCache = new Map<string, { data: unknown; timestamp: number }>();
const RESPONSE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface CondoUnit {
  unitBbl: string;
  borough: string;
  block: string;
  lot: string;
  unitLabel: string | null;
  address: string | null;
  raw: Record<string, unknown>;
}

interface CondoUnitsResponse {
  buildingBbl: string;
  isCondo: boolean;
  buildingContextBbl: string | null;
  billingLotBbl: string | null;
  condoId: string | null;
  units: CondoUnit[];
  totalApprox: number;
  notes: string[];
  requestId: string;
}

// Generate request ID
function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// Discover schema for a dataset
async function discoverSchema(datasetId: string, appToken: string): Promise<Set<string>> {
  const cacheKey = `schema:${datasetId}`;
  const cached = schemaCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SCHEMA_CACHE_TTL) {
    return cached.columns;
  }

  const url = `https://data.cityofnewyork.us/resource/${datasetId}.json?$limit=1`;
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`[discoverSchema] Failed for ${datasetId}: ${response.status}`);
      return new Set();
    }
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return new Set();
    }
    const columns = new Set(Object.keys(rows[0]).map(k => k.toLowerCase()));
    schemaCache.set(cacheKey, { columns, timestamp: Date.now() });
    console.log(`[discoverSchema] ${datasetId}: ${Array.from(columns).join(', ')}`);
    return columns;
  } catch (err) {
    console.error(`[discoverSchema] Error:`, err);
    return new Set();
  }
}

// Find first matching column from candidates
function findColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (columns.has(c.toLowerCase())) return c;
  }
  return null;
}

// Parse BBL into components
function parseBbl(bbl: string): { borough: string; block: string; lot: string } | null {
  if (!bbl || bbl.length !== 10 || !/^\d{10}$/.test(bbl)) {
    return null;
  }
  return {
    borough: bbl.substring(0, 1),
    block: bbl.substring(1, 6),
    lot: bbl.substring(6, 10),
  };
}

// Compose BBL from parts
function composeBbl(borough: string, block: string, lot: string): string {
  return `${borough}${block.padStart(5, '0')}${lot.padStart(4, '0')}`;
}

// Determine if property is a condo based on building class
function isCondoBuildingClass(buildingClass: string | null): boolean {
  if (!buildingClass) return false;
  const cls = buildingClass.toUpperCase().trim();
  // R0-R9 are condo building classes, RR = Condominium Rentals
  return /^R[0-9]$/.test(cls) || cls === 'RR' || cls === 'RS';
}

// Query PLUTO for property info
async function queryPlutoProperty(bbl: string, appToken: string): Promise<{
  found: boolean;
  isCondo: boolean;
  buildingClass: string | null;
  landUse: string | null;
  condoNo: string | null;
  block: string | null;
  borough: string | null;
  address: string | null;
  raw: Record<string, unknown>;
}> {
  const columns = await discoverSchema(PLUTO_DATASET_ID, appToken);
  
  const bblCol = findColumn(columns, ['bbl']);
  if (!bblCol) {
    console.error('[queryPlutoProperty] bbl column not found in PLUTO');
    return { found: false, isCondo: false, buildingClass: null, landUse: null, condoNo: null, block: null, borough: null, address: null, raw: {} };
  }
  
  // Find available columns
  const bldgClassCol = findColumn(columns, ['bldgclass', 'buildingclass', 'building_class']);
  const landUseCol = findColumn(columns, ['landuse', 'land_use']);
  const condoNoCol = findColumn(columns, ['condono', 'condo_no', 'condonumber']);
  const blockCol = findColumn(columns, ['block']);
  const boroCol = findColumn(columns, ['borocode', 'borough', 'boro']);
  const addressCol = findColumn(columns, ['address']);
  
  const selectCols = [bblCol, bldgClassCol, landUseCol, condoNoCol, blockCol, boroCol, addressCol].filter(Boolean);
  const url = `https://data.cityofnewyork.us/resource/${PLUTO_DATASET_ID}.json?$select=${selectCols.join(',')}&$where=${bblCol}='${bbl}'&$limit=1`;
  
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`[queryPlutoProperty] Error: ${response.status}`);
      return { found: false, isCondo: false, buildingClass: null, landUse: null, condoNo: null, block: null, borough: null, address: null, raw: {} };
    }
    
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { found: false, isCondo: false, buildingClass: null, landUse: null, condoNo: null, block: null, borough: null, address: null, raw: {} };
    }
    
    const row = rows[0];
    const buildingClass = bldgClassCol ? String(row[bldgClassCol] || '') : null;
    const landUse = landUseCol ? String(row[landUseCol] || '') : null;
    const condoNo = condoNoCol ? String(row[condoNoCol] || '') : null;
    const block = blockCol ? String(row[blockCol] || '') : null;
    const borough = boroCol ? String(row[boroCol] || '') : null;
    const address = addressCol ? String(row[addressCol] || '') : null;
    
    // Determine condo status - ensure it's a boolean
    const hasCondoClass = isCondoBuildingClass(buildingClass);
    const hasCondoLandUse = landUse === '04';
    const hasCondoNo = Boolean(condoNo && condoNo !== '0' && condoNo !== '');
    const isCondo = hasCondoClass || hasCondoLandUse || hasCondoNo;
    
    return {
      found: true,
      isCondo,
      buildingClass,
      landUse,
      condoNo: condoNo && condoNo !== '0' && condoNo !== '' ? condoNo : null,
      block,
      borough,
      address,
      raw: row,
    };
  } catch (err) {
    console.error('[queryPlutoProperty] Error:', err);
    return { found: false, isCondo: false, buildingClass: null, landUse: null, condoNo: null, block: null, borough: null, address: null, raw: {} };
  }
}

// Query Digital Tax Map: Condominium Units dataset
async function queryCondoUnitsFromDTM(
  borough: string,
  block: string,
  condoNo: string | null,
  appToken: string
): Promise<{ units: CondoUnit[]; totalApprox: number }> {
  const columns = await discoverSchema(CONDO_UNITS_DATASET_ID, appToken);
  
  if (columns.size === 0) {
    console.log('[queryCondoUnitsFromDTM] No columns discovered - dataset may be unavailable');
    return { units: [], totalApprox: 0 };
  }
  
  console.log(`[queryCondoUnitsFromDTM] Available columns: ${Array.from(columns).join(', ')}`);
  
  // Find available columns for filtering and selection
  const bblCol = findColumn(columns, ['bbl', 'condo_bbl', 'unit_bbl', 'tax_lot_bbl']);
  const boroCol = findColumn(columns, ['boro', 'borough', 'borough_code', 'borocode']);
  const blockCol = findColumn(columns, ['block', 'tax_block', 'condo_block']);
  const lotCol = findColumn(columns, ['lot', 'tax_lot', 'condo_lot', 'unit_lot']);
  const condoNoCol = findColumn(columns, ['condo_no', 'condono', 'condo_number', 'condo_id', 'condonumber']);
  const unitDesigCol = findColumn(columns, ['unit_desig', 'unit_designation', 'unit', 'apt', 'apartment', 'unit_number']);
  const addressCol = findColumn(columns, ['address', 'street_address', 'unit_address']);
  
  // Build WHERE clause based on available columns
  let whereClause = '';
  
  // Try condo number first (most specific)
  if (condoNo && condoNoCol) {
    whereClause = `${condoNoCol}='${condoNo}'`;
    console.log(`[queryCondoUnitsFromDTM] Using condo number filter: ${condoNoCol}='${condoNo}'`);
  } 
  // Fall back to borough + block (less specific but should work)
  else if (boroCol && blockCol) {
    whereClause = `${boroCol}='${borough}' AND ${blockCol}='${parseInt(block, 10)}'`;
    console.log(`[queryCondoUnitsFromDTM] Using borough+block filter: ${whereClause}`);
  }
  // Last resort: just borough
  else if (boroCol) {
    whereClause = `${boroCol}='${borough}'`;
    console.log(`[queryCondoUnitsFromDTM] Using borough only filter: ${whereClause}`);
  } else {
    console.log('[queryCondoUnitsFromDTM] Cannot build WHERE clause - missing required columns');
    return { units: [], totalApprox: 0 };
  }
  
  // Build select clause
  const selectCols: string[] = [];
  if (bblCol) selectCols.push(bblCol);
  if (boroCol) selectCols.push(boroCol);
  if (blockCol) selectCols.push(blockCol);
  if (lotCol) selectCols.push(lotCol);
  if (unitDesigCol) selectCols.push(unitDesigCol);
  if (addressCol) selectCols.push(addressCol);
  if (condoNoCol) selectCols.push(condoNoCol);
  
  // Add any other columns we haven't selected yet (up to a reasonable limit)
  for (const col of columns) {
    if (!selectCols.includes(col) && selectCols.length < 15) {
      selectCols.push(col);
    }
  }
  
  // First, get count
  let totalApprox = 0;
  try {
    const countUrl = `https://data.cityofnewyork.us/resource/${CONDO_UNITS_DATASET_ID}.json?$select=count(*)&$where=${encodeURIComponent(whereClause)}`;
    const countResp = await fetch(countUrl, {
      headers: { 'Accept': 'application/json', ...(appToken ? { 'X-App-Token': appToken } : {}) },
    });
    if (countResp.ok) {
      const countData = await countResp.json();
      if (Array.isArray(countData) && countData.length > 0) {
        totalApprox = parseInt(countData[0].count || '0', 10);
      }
    }
  } catch (e) {
    console.error('[queryCondoUnitsFromDTM] Count query failed:', e);
  }
  
  // Fetch units (paginated, get all)
  const allUnits: CondoUnit[] = [];
  let offset = 0;
  const limit = 1000;
  
  while (true) {
    const url = `https://data.cityofnewyork.us/resource/${CONDO_UNITS_DATASET_ID}.json?$select=${selectCols.join(',')}&$where=${encodeURIComponent(whereClause)}&$order=${bblCol || lotCol || 'null'}&$limit=${limit}&$offset=${offset}`;
    
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (appToken) headers['X-App-Token'] = appToken;
    
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        console.error(`[queryCondoUnitsFromDTM] Error: ${response.status}`);
        break;
      }
      
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }
      
      for (const row of rows) {
        // Extract BBL - might be directly available or need to be composed
        let unitBbl = bblCol ? String(row[bblCol] || '') : '';
        const rowBorough = boroCol ? String(row[boroCol] || '') : borough;
        const rowBlock = blockCol ? String(row[blockCol] || '') : block;
        const rowLot = lotCol ? String(row[lotCol] || '') : '';
        
        // If no BBL column, try to compose it
        if (!unitBbl && rowBorough && rowBlock && rowLot) {
          unitBbl = composeBbl(rowBorough, rowBlock, rowLot);
        }
        
        // Skip if we couldn't determine BBL
        if (!unitBbl || unitBbl.length !== 10) {
          continue;
        }
        
        // Extract unit label from available fields
        let unitLabel: string | null = null;
        if (unitDesigCol && row[unitDesigCol]) {
          unitLabel = String(row[unitDesigCol]);
        }
        
        // Extract address
        let unitAddress: string | null = null;
        if (addressCol && row[addressCol]) {
          unitAddress = String(row[addressCol]);
        }
        
        allUnits.push({
          unitBbl,
          borough: rowBorough,
          block: rowBlock.replace(/^0+/, '') || '0',
          lot: rowLot.replace(/^0+/, '') || '0',
          unitLabel,
          address: unitAddress,
          raw: row,
        });
      }
      
      if (rows.length < limit) {
        break; // No more pages
      }
      offset += limit;
      
      // Safety limit - don't fetch more than 5000 units
      if (allUnits.length >= 5000) {
        console.log('[queryCondoUnitsFromDTM] Reached safety limit of 5000 units');
        break;
      }
    } catch (err) {
      console.error('[queryCondoUnitsFromDTM] Error:', err);
      break;
    }
  }
  
  // Deduplicate by unitBbl
  const uniqueUnits = new Map<string, CondoUnit>();
  for (const unit of allUnits) {
    if (!uniqueUnits.has(unit.unitBbl)) {
      uniqueUnits.set(unit.unitBbl, unit);
    }
  }
  
  return { 
    units: Array.from(uniqueUnits.values()).sort((a, b) => a.unitBbl.localeCompare(b.unitBbl)),
    totalApprox: totalApprox || allUnits.length,
  };
}

// Fallback: Query units from PLUTO by condo number or block with R-class buildings
async function queryCondoUnitsFromPluto(
  borough: string,
  block: string,
  condoNo: string | null,
  appToken: string
): Promise<{ units: CondoUnit[]; totalApprox: number }> {
  const columns = await discoverSchema(PLUTO_DATASET_ID, appToken);
  
  const bblCol = findColumn(columns, ['bbl']);
  const boroCol = findColumn(columns, ['borocode', 'borough', 'boro']);
  const blockCol = findColumn(columns, ['block']);
  const lotCol = findColumn(columns, ['lot']);
  const condoNoCol = findColumn(columns, ['condono', 'condo_no']);
  const bldgClassCol = findColumn(columns, ['bldgclass', 'buildingclass']);
  const addressCol = findColumn(columns, ['address']);
  
  if (!bblCol) {
    return { units: [], totalApprox: 0 };
  }
  
  let whereClause: string;
  if (condoNo && condoNoCol) {
    whereClause = `${condoNoCol}='${condoNo}'`;
    if (boroCol) whereClause += ` AND ${boroCol}='${borough}'`;
  } else if (boroCol && blockCol) {
    whereClause = `${boroCol}='${borough}' AND ${blockCol}='${parseInt(block, 10)}'`;
    // Filter by R-class building codes if available
    if (bldgClassCol) {
      whereClause += ` AND ${bldgClassCol} LIKE 'R%'`;
    }
  } else {
    return { units: [], totalApprox: 0 };
  }
  
  const selectCols = [bblCol, lotCol, addressCol].filter(Boolean);
  const url = `https://data.cityofnewyork.us/resource/${PLUTO_DATASET_ID}.json?$select=${selectCols.join(',')}&$where=${encodeURIComponent(whereClause)}&$order=${bblCol}&$limit=500`;
  
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return { units: [], totalApprox: 0 };
    }
    
    const rows = await response.json();
    if (!Array.isArray(rows)) return { units: [], totalApprox: 0 };
    
    const units = rows.map((row: Record<string, unknown>) => {
      const unitBbl = String(row[bblCol as string] || '');
      const parsed = parseBbl(unitBbl);
      return {
        unitBbl,
        borough: parsed?.borough || borough,
        block: parsed?.block?.replace(/^0+/, '') || block.replace(/^0+/, ''),
        lot: parsed?.lot?.replace(/^0+/, '') || String(row[lotCol as string] || '').replace(/^0+/, ''),
        unitLabel: null,
        address: addressCol ? String(row[addressCol] || '') : null,
        raw: row,
      };
    }).filter((u: CondoUnit) => u.unitBbl.length === 10);
    
    return { units, totalApprox: units.length };
  } catch (err) {
    console.error('[queryCondoUnitsFromPluto] Error:', err);
    return { units: [], totalApprox: 0 };
  }
}

Deno.serve(async (req) => {
  const requestId = generateRequestId();
  console.log(`[${requestId}] condo-units request received`);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const url = new URL(req.url);
    // Support both ?bbl= and ?buildingBbl= parameters
    const bbl = url.searchParams.get('bbl') || url.searchParams.get('buildingBbl');
    
    // Validate BBL
    if (!bbl || !/^\d{10}$/.test(bbl)) {
      return new Response(
        JSON.stringify({
          error: 'Invalid BBL',
          userMessage: 'BBL must be exactly 10 digits.',
          requestId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Check cache
    const cacheKey = `condo-units-${bbl}`;
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < RESPONSE_CACHE_TTL) {
      console.log(`[${requestId}] Returning cached response`);
      return new Response(JSON.stringify(cached.data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    const parsed = parseBbl(bbl);
    
    if (!parsed) {
      return new Response(
        JSON.stringify({
          error: 'Invalid BBL format',
          userMessage: 'Could not parse BBL.',
          requestId,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const notes: string[] = [];
    
    // Step 1: Query PLUTO for property info and condo detection
    const plutoInfo = await queryPlutoProperty(bbl, appToken);
    
    if (!plutoInfo.found) {
      notes.push('Property not found in PLUTO dataset.');
      const response: CondoUnitsResponse = {
        buildingBbl: bbl,
        isCondo: false,
        buildingContextBbl: null,
        billingLotBbl: null,
        condoId: null,
        units: [],
        totalApprox: 0,
        notes,
        requestId,
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Check if it's a condo
    if (!plutoInfo.isCondo) {
      notes.push('This property is not classified as a condominium based on building class and land use indicators.');
      notes.push('Multifamily rental buildings typically have a single BBL with multiple residential units, not separate tax lots per apartment.');
      
      const response: CondoUnitsResponse = {
        buildingBbl: bbl,
        isCondo: false,
        buildingContextBbl: bbl,
        billingLotBbl: null,
        condoId: null,
        units: [],
        totalApprox: 0,
        notes,
        requestId,
      };
      
      responseCache.set(cacheKey, { data: response, timestamp: Date.now() });
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // It's a condo - try to enumerate units
    notes.push(`Condominium detected (Building Class: ${plutoInfo.buildingClass || 'N/A'}, Land Use: ${plutoInfo.landUse || 'N/A'}).`);
    
    let units: CondoUnit[] = [];
    let totalApprox = 0;
    const condoId = plutoInfo.condoNo;
    
    // Try Digital Tax Map: Condominium Units dataset first (eguu-7ie3)
    console.log(`[${requestId}] Querying DTM Condo Units dataset...`);
    const dtmResult = await queryCondoUnitsFromDTM(parsed.borough, parsed.block, condoId, appToken);
    
    if (dtmResult.units.length > 0) {
      units = dtmResult.units;
      totalApprox = dtmResult.totalApprox;
      notes.push(`Found ${units.length} unit lots from Digital Tax Map dataset.`);
    } else {
      // Fallback to PLUTO
      console.log(`[${requestId}] DTM returned no units, falling back to PLUTO...`);
      const plutoResult = await queryCondoUnitsFromPluto(parsed.borough, parsed.block, condoId, appToken);
      units = plutoResult.units;
      totalApprox = plutoResult.totalApprox;
      
      if (units.length > 0) {
        notes.push(`Found ${units.length} condo-classified lots from PLUTO dataset.`);
      }
    }
    
    // Filter out the input BBL from units if it's included (it's the building, not a unit)
    const filteredUnits = units.filter(u => u.unitBbl !== bbl);
    
    if (filteredUnits.length === 0) {
      notes.push('Unit lots could not be enumerated from available data sources. This BBL may itself be a unit lot, or the condo data may not be available.');
    }
    
    // Building context BBL - use the input BBL as building context
    const buildingContextBbl = bbl;
    
    const response: CondoUnitsResponse = {
      buildingBbl: bbl,
      isCondo: true,
      buildingContextBbl,
      billingLotBbl: null, // Would need additional dataset to determine billing lot
      condoId: condoId || null,
      units: filteredUnits,
      totalApprox: totalApprox > 0 ? totalApprox : filteredUnits.length,
      notes,
      requestId,
    };
    
    responseCache.set(cacheKey, { data: response, timestamp: Date.now() });
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (err) {
    console.error(`[${requestId}] Error:`, err);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        userMessage: 'An unexpected error occurred while processing your request.',
        requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
