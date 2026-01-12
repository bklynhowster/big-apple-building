/**
 * NYC Landmark Lookup Module
 * Uses NYC Open Data Socrata datasets:
 * - LPC Individual Landmark Sites: buis-pvji
 * - LPC Historic Districts: xbvj-gfnw
 * Also accepts PLUTO histdist field as a source
 */

export type LandmarkResult = {
  status: 'yes' | 'no' | 'unknown';
  isIndividual: boolean;
  isHistoricDistrict: boolean;
  individualName?: string;
  individualDate?: string;
  districtName?: string;
  source?: 'lpc' | 'pluto' | 'unknown';
  debugReason?: string; // For DEV diagnostics
};

const SOCRATA_BASE = 'https://data.cityofnewyork.us/resource';
const INDIVIDUAL_LANDMARKS_DATASET = 'buis-pvji';
const HISTORIC_DISTRICTS_DATASET = 'xbvj-gfnw';
const TIMEOUT_MS = 6000;

const isDebug = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return import.meta.env.DEV && params.get('debug') === '1';
};

function debugLog(label: string, data: Record<string, unknown>) {
  if (isDebug()) {
    console.log(`[LandmarkFetch] ${label}`, data);
  }
}

/**
 * Normalize BBL to 10-digit string with leading zeros
 */
export function normalizeBBL(bbl: string | number | null | undefined): string | null {
  if (bbl === null || bbl === undefined) return null;
  
  // Convert to string and strip non-digits
  const digits = String(bbl).replace(/\D/g, '');
  
  if (digits.length === 0) return null;
  if (digits.length === 10) return digits;
  if (digits.length < 10) return digits.padStart(10, '0');
  
  // If longer than 10, it's invalid
  return null;
}

/**
 * Fetch with timeout wrapper
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check if a point is inside a polygon (ray casting algorithm)
 */
function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Check if point is in any ring of a multipolygon
 */
function pointInMultiPolygon(point: [number, number], multiPolygon: [number, number][][][]): boolean {
  for (const polygon of multiPolygon) {
    if (polygon.length > 0 && pointInPolygon(point, polygon[0])) {
      let inHole = false;
      for (let i = 1; i < polygon.length; i++) {
        if (pointInPolygon(point, polygon[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

interface IndividualLandmarkRecord {
  lpc_num?: string;
  lm_name?: string;
  desig_date?: string;
  bbl?: string;
  bin_number?: string;
  the_geom?: {
    type: string;
    coordinates: number[] | number[][] | number[][][] | number[][][][];
  };
}

interface HistoricDistrictRecord {
  area_name?: string;
  hist_dist?: string;
  the_geom?: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

/**
 * Query Individual Landmarks dataset
 * Tries BBL match, then BIN match, then spatial query
 */
async function checkIndividualLandmark(
  bbl: string,
  bin?: string,
  lat?: number,
  lon?: number
): Promise<{ isLandmark: boolean; name?: string; date?: string; debugReason?: string }> {
  const bblNormalized = normalizeBBL(bbl);
  
  try {
    // Try BBL match first - use quoted string comparison
    if (bblNormalized) {
      const bblUrl = `${SOCRATA_BASE}/${INDIVIDUAL_LANDMARKS_DATASET}.json?$where=bbl='${bblNormalized}'&$limit=1&$select=lm_name,desig_date,bbl`;
      
      debugLog('Individual BBL Query', { url: bblUrl, bblRaw: bbl, bblNormalized });
      
      const bblResponse = await fetchWithTimeout(bblUrl, TIMEOUT_MS);
      
      if (bblResponse.ok) {
        const bblData: IndividualLandmarkRecord[] = await bblResponse.json();
        debugLog('Individual BBL Response', { 
          status: 'ok', 
          httpStatus: bblResponse.status, 
          rowCount: bblData.length,
          sampleRow: bblData[0] || null 
        });
        
        if (bblData.length > 0) {
          return {
            isLandmark: true,
            name: bblData[0].lm_name,
            date: bblData[0].desig_date,
          };
        }
      } else {
        debugLog('Individual BBL Response', { 
          status: 'http_error', 
          httpStatus: bblResponse.status 
        });
      }
    }

    // Try BIN match if available
    if (bin) {
      const binNormalized = bin.replace(/\D/g, '');
      if (binNormalized.length > 0) {
        const binUrl = `${SOCRATA_BASE}/${INDIVIDUAL_LANDMARKS_DATASET}.json?$where=bin_number='${binNormalized}'&$limit=1&$select=lm_name,desig_date,bin_number`;
        
        debugLog('Individual BIN Query', { url: binUrl, bin: binNormalized });
        
        const binResponse = await fetchWithTimeout(binUrl, TIMEOUT_MS);
        if (binResponse.ok) {
          const binData: IndividualLandmarkRecord[] = await binResponse.json();
          debugLog('Individual BIN Response', { 
            status: 'ok', 
            httpStatus: binResponse.status, 
            rowCount: binData.length 
          });
          
          if (binData.length > 0) {
            return {
              isLandmark: true,
              name: binData[0].lm_name,
              date: binData[0].desig_date,
            };
          }
        }
      }
    }

    // Spatial query if we have coordinates
    if (lat !== undefined && lon !== undefined) {
      const spatialUrl = `${SOCRATA_BASE}/${INDIVIDUAL_LANDMARKS_DATASET}.json?$where=within_circle(the_geom,${lat},${lon},50)&$limit=5&$select=lm_name,desig_date,the_geom`;
      
      debugLog('Individual Spatial Query', { url: spatialUrl, lat, lon });
      
      const spatialResponse = await fetchWithTimeout(spatialUrl, TIMEOUT_MS);
      if (spatialResponse.ok) {
        const spatialData: IndividualLandmarkRecord[] = await spatialResponse.json();
        debugLog('Individual Spatial Response', { 
          status: 'ok', 
          rowCount: spatialData.length 
        });
        
        for (const record of spatialData) {
          if (record.the_geom) {
            const geom = record.the_geom;
            const point: [number, number] = [lon, lat];
            
            if (geom.type === 'Point') {
              return {
                isLandmark: true,
                name: record.lm_name,
                date: record.desig_date,
              };
            } else if (geom.type === 'Polygon') {
              const coords = geom.coordinates as number[][][];
              if (coords.length > 0 && pointInPolygon(point, coords[0] as [number, number][])) {
                return {
                  isLandmark: true,
                  name: record.lm_name,
                  date: record.desig_date,
                };
              }
            } else if (geom.type === 'MultiPolygon') {
              const coords = geom.coordinates as number[][][][];
              if (pointInMultiPolygon(point, coords as [number, number][][][])) {
                return {
                  isLandmark: true,
                  name: record.lm_name,
                  date: record.desig_date,
                };
              }
            }
          }
        }
      }
    }

    return { isLandmark: false, debugReason: 'no_rows_individual' };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'fetch_error';
    debugLog('Individual Landmark Error', { error: String(error), reason });
    return { isLandmark: false, debugReason: reason };
  }
}

/**
 * Query Historic Districts dataset using spatial query
 */
async function checkHistoricDistrict(
  lat?: number,
  lon?: number
): Promise<{ inDistrict: boolean; districtName?: string; debugReason?: string }> {
  if (lat === undefined || lon === undefined) {
    return { inDistrict: false, debugReason: 'no_coords' };
  }

  try {
    const url = `${SOCRATA_BASE}/${HISTORIC_DISTRICTS_DATASET}.json?$where=within_circle(the_geom,${lat},${lon},200)&$limit=10&$select=area_name,hist_dist,the_geom`;
    
    debugLog('Historic District Query', { url, lat, lon });
    
    const response = await fetchWithTimeout(url, TIMEOUT_MS);
    if (!response.ok) {
      debugLog('Historic District Response', { status: 'http_error', httpStatus: response.status });
      return { inDistrict: false, debugReason: `http_${response.status}` };
    }

    const data: HistoricDistrictRecord[] = await response.json();
    debugLog('Historic District Response', { 
      status: 'ok', 
      httpStatus: response.status, 
      rowCount: data.length 
    });
    
    const point: [number, number] = [lon, lat];

    for (const record of data) {
      if (record.the_geom) {
        const geom = record.the_geom;
        
        if (geom.type === 'Polygon') {
          const coords = geom.coordinates as number[][][];
          if (coords.length > 0 && pointInPolygon(point, coords[0] as [number, number][])) {
            return {
              inDistrict: true,
              districtName: record.area_name || record.hist_dist,
            };
          }
        } else if (geom.type === 'MultiPolygon') {
          const coords = geom.coordinates as number[][][][];
          if (pointInMultiPolygon(point, coords as [number, number][][][])) {
            return {
              inDistrict: true,
              districtName: record.area_name || record.hist_dist,
            };
          }
        }
      }
    }

    return { inDistrict: false, debugReason: 'no_rows_district' };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'fetch_error';
    debugLog('Historic District Error', { error: String(error), reason });
    return { inDistrict: false, debugReason: reason };
  }
}

/**
 * Main landmark status lookup function
 * @param args.bbl - BBL string
 * @param args.bin - Optional BIN for additional lookup
 * @param args.lat - Latitude for spatial queries
 * @param args.lon - Longitude for spatial queries  
 * @param args.plutoHistDist - PLUTO histdist field if available (from property profile)
 */
export async function getLandmarkStatus(args: {
  bbl: string;
  bin?: string;
  lat?: number;
  lon?: number;
  plutoHistDist?: string | null;
}): Promise<LandmarkResult> {
  const { bbl, bin, lat, lon, plutoHistDist } = args;
  const bblNormalized = normalizeBBL(bbl);
  
  debugLog('Starting Lookup', { 
    bblRaw: bbl, 
    bblNormalized, 
    bin, 
    lat, 
    lon, 
    plutoHistDist 
  });

  // Quick check: If PLUTO has histdist, we know it's in a historic district
  if (plutoHistDist && plutoHistDist.trim().length > 0) {
    debugLog('PLUTO histdist found', { histdist: plutoHistDist });
    return {
      status: 'yes',
      isIndividual: false,
      isHistoricDistrict: true,
      districtName: plutoHistDist.trim(),
      source: 'pluto',
    };
  }

  if (!bblNormalized) {
    debugLog('Invalid BBL', { bblRaw: bbl });
    return {
      status: 'unknown',
      isIndividual: false,
      isHistoricDistrict: false,
      source: 'unknown',
      debugReason: 'invalid_bbl',
    };
  }

  // Run LPC queries in parallel
  const [individualOutcome, districtOutcome] = await Promise.allSettled([
    checkIndividualLandmark(bblNormalized, bin, lat, lon),
    checkHistoricDistrict(lat, lon),
  ]);

  let individualResult: { isLandmark: boolean; name?: string; date?: string; debugReason?: string } | null = null;
  let districtResult: { inDistrict: boolean; districtName?: string; debugReason?: string } | null = null;
  const debugReasons: string[] = [];

  if (individualOutcome.status === 'fulfilled') {
    individualResult = individualOutcome.value;
    if (individualResult.debugReason) {
      debugReasons.push(individualResult.debugReason);
    }
  } else {
    debugReasons.push('individual_rejected');
  }

  if (districtOutcome.status === 'fulfilled') {
    districtResult = districtOutcome.value;
    if (districtResult.debugReason) {
      debugReasons.push(districtResult.debugReason);
    }
  } else {
    debugReasons.push('district_rejected');
  }

  const isIndividual = individualResult?.isLandmark ?? false;
  const isHistoricDistrict = districtResult?.inDistrict ?? false;

  // If both queries failed completely, status is unknown
  if (individualResult === null && districtResult === null) {
    return {
      status: 'unknown',
      isIndividual: false,
      isHistoricDistrict: false,
      source: 'unknown',
      debugReason: debugReasons.join(',') || 'both_queries_failed',
    };
  }

  const isLandmarked = isIndividual || isHistoricDistrict;

  if (isLandmarked) {
    return {
      status: 'yes',
      isIndividual,
      isHistoricDistrict,
      individualName: individualResult?.name,
      individualDate: individualResult?.date,
      districtName: districtResult?.districtName,
      source: 'lpc',
    };
  }

  // Both queries succeeded but no matches
  return {
    status: 'no',
    isIndividual: false,
    isHistoricDistrict: false,
    source: 'lpc',
    debugReason: debugReasons.join(',') || 'no_matches',
  };
}
