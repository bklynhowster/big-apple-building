import "https://deno.land/x/xhr@0.3.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC PLUTO dataset ID
const PLUTO_DATASET_ID = '64uk-42ks';
// NYC Condo Units from DOF dataset
const CONDO_UNITS_DATASET_ID = '7ugf-7dct'; // DOF Condominium Comparable Rental Income

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
  raw: Record<string, unknown>;
}

interface CondoUnitsResponse {
  inputBbl: string;
  isCondo: boolean;
  buildingContextBbl: string | null;
  billingLotBbl: string | null;
  condoId: string | null;
  units: CondoUnit[];
  notes: string[];
  requestId: string;
}

// Discover schema for a dataset
async function discoverSchema(datasetId: string, appToken: string): Promise<Set<string>> {
  const cached = schemaCache.get(datasetId);
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
    const columns = new Set(Object.keys(rows[0]));
    schemaCache.set(datasetId, { columns, timestamp: Date.now() });
    console.log(`[discoverSchema] ${datasetId}: ${Array.from(columns).join(', ')}`);
    return columns;
  } catch (err) {
    console.error(`[discoverSchema] Error:`, err);
    return new Set();
  }
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

// Determine if property is a condo based on building class
function isCondoBuildingClass(buildingClass: string | null): boolean {
  if (!buildingClass) return false;
  const cls = buildingClass.toUpperCase().trim();
  // R1-R9 are condo building classes
  // R4 = Residential Condo
  // RR = Condominium Rentals
  return /^R[1-9]$/.test(cls) || cls === 'RR';
}

// Determine if land use indicates condo
function isCondoLandUse(landUse: string | null): boolean {
  if (!landUse) return false;
  // Land use 04 is typically condos
  return landUse === '04';
}

// Query PLUTO for property info
async function queryPlutoProperty(bbl: string, appToken: string): Promise<{
  found: boolean;
  isCondo: boolean;
  buildingClass: string | null;
  landUse: string | null;
  condoNo: string | null;
  unitsRes: number | null;
  raw: Record<string, unknown>;
}> {
  const columns = await discoverSchema(PLUTO_DATASET_ID, appToken);
  
  // Build column list from confirmed columns
  const wantedColumns = ['bbl', 'borocode', 'block', 'lot', 'bldgclass', 'landuse', 'condono', 'unitsres', 'unitstotal', 'address', 'yearbuilt'];
  const confirmedColumns = wantedColumns.filter(c => columns.has(c));
  
  if (!columns.has('bbl')) {
    console.error('[queryPlutoProperty] bbl column not found in PLUTO');
    return { found: false, isCondo: false, buildingClass: null, landUse: null, condoNo: null, unitsRes: null, raw: {} };
  }
  
  const selectClause = confirmedColumns.length > 0 ? confirmedColumns.join(',') : '*';
  const url = `https://data.cityofnewyork.us/resource/${PLUTO_DATASET_ID}.json?$select=${selectClause}&$where=bbl='${bbl}'&$limit=1`;
  
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`[queryPlutoProperty] Error: ${response.status}`);
      return { found: false, isCondo: false, buildingClass: null, landUse: null, condoNo: null, unitsRes: null, raw: {} };
    }
    
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { found: false, isCondo: false, buildingClass: null, landUse: null, condoNo: null, unitsRes: null, raw: {} };
    }
    
    const row = rows[0];
    const buildingClass = row.bldgclass || null;
    const landUse = row.landuse || null;
    const condoNo = row.condono || null;
    const unitsRes = row.unitsres ? parseInt(row.unitsres, 10) : null;
    
    const isCondo = isCondoBuildingClass(buildingClass) || isCondoLandUse(landUse) || (condoNo && condoNo !== '0' && condoNo !== '');
    
    return {
      found: true,
      isCondo,
      buildingClass,
      landUse,
      condoNo,
      unitsRes,
      raw: row,
    };
  } catch (err) {
    console.error('[queryPlutoProperty] Error:', err);
    return { found: false, isCondo: false, buildingClass: null, landUse: null, condoNo: null, unitsRes: null, raw: {} };
  }
}

// Query for condo unit lots using PLUTO by condo number
async function queryCondoUnitsFromPluto(
  borough: string,
  block: string,
  condoNo: string,
  appToken: string
): Promise<CondoUnit[]> {
  const columns = await discoverSchema(PLUTO_DATASET_ID, appToken);
  
  // Build query based on available columns
  const hasBorocode = columns.has('borocode');
  const hasBlock = columns.has('block');
  const hasCondono = columns.has('condono');
  const hasBbl = columns.has('bbl');
  const hasLot = columns.has('lot');
  
  if (!hasCondono || !hasBbl) {
    console.log('[queryCondoUnitsFromPluto] Required columns not available');
    return [];
  }
  
  let whereClause = `condono='${condoNo}'`;
  
  // Add borough/block constraints if available to narrow results
  if (hasBorocode) {
    whereClause += ` AND borocode='${borough}'`;
  }
  if (hasBlock) {
    // Block in PLUTO is numeric, remove leading zeros for comparison
    const blockNum = parseInt(block, 10);
    whereClause += ` AND block='${blockNum}'`;
  }
  
  const selectColumns = ['bbl'];
  if (hasLot) selectColumns.push('lot');
  if (columns.has('address')) selectColumns.push('address');
  if (columns.has('apt')) selectColumns.push('apt');
  if (columns.has('unittype')) selectColumns.push('unittype');
  
  const url = `https://data.cityofnewyork.us/resource/${PLUTO_DATASET_ID}.json?$select=${selectColumns.join(',')}&$where=${encodeURIComponent(whereClause)}&$order=bbl&$limit=500`;
  
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`[queryCondoUnitsFromPluto] Error: ${response.status}`);
      return [];
    }
    
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    
    return rows.map((row: Record<string, unknown>) => {
      const unitBbl = String(row.bbl || '');
      const parsed = parseBbl(unitBbl);
      return {
        unitBbl,
        borough: parsed?.borough || borough,
        block: parsed?.block || block,
        lot: parsed?.lot || String(row.lot || ''),
        unitLabel: row.apt as string || row.address as string || null,
        raw: row,
      };
    });
  } catch (err) {
    console.error('[queryCondoUnitsFromPluto] Error:', err);
    return [];
  }
}

// Alternative: Query units by block and lot range for condos
async function queryCondoUnitsByBlockRange(
  borough: string,
  block: string,
  appToken: string
): Promise<CondoUnit[]> {
  const columns = await discoverSchema(PLUTO_DATASET_ID, appToken);
  
  const hasBorocode = columns.has('borocode');
  const hasBlock = columns.has('block');
  const hasBbl = columns.has('bbl');
  const hasLot = columns.has('lot');
  const hasBldgclass = columns.has('bldgclass');
  
  if (!hasBbl || !hasBorocode || !hasBlock) {
    return [];
  }
  
  const blockNum = parseInt(block, 10);
  let whereClause = `borocode='${borough}' AND block='${blockNum}'`;
  
  // Filter by condo building classes if available
  if (hasBldgclass) {
    whereClause += ` AND (bldgclass LIKE 'R%')`;
  }
  
  const selectColumns = ['bbl'];
  if (hasLot) selectColumns.push('lot');
  if (columns.has('address')) selectColumns.push('address');
  if (hasBldgclass) selectColumns.push('bldgclass');
  
  const url = `https://data.cityofnewyork.us/resource/${PLUTO_DATASET_ID}.json?$select=${selectColumns.join(',')}&$where=${encodeURIComponent(whereClause)}&$order=bbl&$limit=500`;
  
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return [];
    
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    
    // Filter to only condo building classes
    return rows
      .filter((row: Record<string, unknown>) => {
        const cls = String(row.bldgclass || '').toUpperCase();
        return /^R[1-9]$/.test(cls) || cls === 'RR';
      })
      .map((row: Record<string, unknown>) => {
        const unitBbl = String(row.bbl || '');
        const parsed = parseBbl(unitBbl);
        return {
          unitBbl,
          borough: parsed?.borough || borough,
          block: parsed?.block || block,
          lot: parsed?.lot || String(row.lot || ''),
          unitLabel: row.address as string || null,
          raw: row,
        };
      });
  } catch (err) {
    console.error('[queryCondoUnitsByBlockRange] Error:', err);
    return [];
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  console.log(`[${requestId}] condo-units request received`);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const url = new URL(req.url);
    const bbl = url.searchParams.get('bbl');
    
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
    
    // Step 1: Query PLUTO for property info
    const plutoInfo = await queryPlutoProperty(bbl, appToken);
    
    if (!plutoInfo.found) {
      notes.push('Property not found in PLUTO dataset.');
      const response: CondoUnitsResponse = {
        inputBbl: bbl,
        isCondo: false,
        buildingContextBbl: null,
        billingLotBbl: null,
        condoId: null,
        units: [],
        notes,
        requestId,
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Check if it's a condo
    if (!plutoInfo.isCondo) {
      // Not a condo - provide context about multifamily rentals
      if (plutoInfo.unitsRes && plutoInfo.unitsRes > 1) {
        notes.push(`This property has ${plutoInfo.unitsRes} residential units but is not classified as a condominium.`);
        notes.push('Multifamily rental buildings typically have a single BBL with multiple units, not separate lots per apartment.');
      } else {
        notes.push('This property is not classified as a condominium based on building class and land use indicators.');
      }
      
      const response: CondoUnitsResponse = {
        inputBbl: bbl,
        isCondo: false,
        buildingContextBbl: bbl,
        billingLotBbl: null,
        condoId: null,
        units: [],
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
    let condoId = plutoInfo.condoNo;
    
    // Try to get units by condo number first
    if (condoId && condoId !== '0' && condoId !== '') {
      units = await queryCondoUnitsFromPluto(parsed.borough, parsed.block, condoId, appToken);
      if (units.length > 0) {
        notes.push(`Found ${units.length} unit lots using condo number ${condoId}.`);
      }
    }
    
    // If no units found by condo number, try by block with condo building classes
    if (units.length === 0) {
      units = await queryCondoUnitsByBlockRange(parsed.borough, parsed.block, appToken);
      if (units.length > 0) {
        notes.push(`Found ${units.length} condo-classified lots in block ${parsed.block}.`);
      }
    }
    
    // Filter out the input BBL from units if it's included
    const filteredUnits = units.filter(u => u.unitBbl !== bbl);
    
    // If we only have the input BBL, it might be that this IS a unit lot
    if (filteredUnits.length === 0 && units.length === 0) {
      notes.push('Unit lots could not be enumerated from available data sources. This BBL may itself be a unit lot.');
    }
    
    // Determine building context BBL (often the billing lot or main condo record)
    // For now, use the input BBL as building context if we can't determine otherwise
    const buildingContextBbl = bbl;
    
    const response: CondoUnitsResponse = {
      inputBbl: bbl,
      isCondo: true,
      buildingContextBbl,
      billingLotBbl: null, // Would need additional dataset to determine
      condoId: condoId || null,
      units: filteredUnits,
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
