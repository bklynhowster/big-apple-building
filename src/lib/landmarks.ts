/**
 * NYC Landmark Lookup Module
 * Uses NYC Open Data Socrata datasets:
 * - LPC Individual Landmark Sites: buis-pvji
 * - LPC Historic Districts: xbvj-gfnw
 */

export type LandmarkResult = {
  status: 'yes' | 'no' | 'unknown';
  isIndividual: boolean;
  isHistoricDistrict: boolean;
  individualName?: string;
  individualDate?: string;
  districtName?: string;
  source?: 'lpc' | 'unknown';
};

const SOCRATA_BASE = 'https://data.cityofnewyork.us/resource';
const INDIVIDUAL_LANDMARKS_DATASET = 'buis-pvji';
const HISTORIC_DISTRICTS_DATASET = 'xbvj-gfnw';
const TIMEOUT_MS = 6000;

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
    // Check outer ring (first ring)
    if (polygon.length > 0 && pointInPolygon(point, polygon[0])) {
      // Check if inside any holes (subsequent rings)
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
 * First tries BBL match, then falls back to spatial query
 */
async function checkIndividualLandmark(
  bbl: string,
  lat?: number,
  lon?: number
): Promise<{ isLandmark: boolean; name?: string; date?: string }> {
  try {
    // Try BBL match first - the dataset has 'bbl' field
    const bblUrl = `${SOCRATA_BASE}/${INDIVIDUAL_LANDMARKS_DATASET}.json?$where=bbl='${bbl}'&$limit=1`;
    
    const bblResponse = await fetchWithTimeout(bblUrl, TIMEOUT_MS);
    if (bblResponse.ok) {
      const bblData: IndividualLandmarkRecord[] = await bblResponse.json();
      if (bblData.length > 0) {
        return {
          isLandmark: true,
          name: bblData[0].lm_name,
          date: bblData[0].desig_date,
        };
      }
    }

    // If no BBL match and we have coordinates, try spatial query
    if (lat !== undefined && lon !== undefined) {
      // Socrata supports within_circle for point features
      // Query landmarks within ~50 meters and check geometry
      const spatialUrl = `${SOCRATA_BASE}/${INDIVIDUAL_LANDMARKS_DATASET}.json?$where=within_circle(the_geom,${lat},${lon},100)&$limit=10`;
      
      const spatialResponse = await fetchWithTimeout(spatialUrl, TIMEOUT_MS);
      if (spatialResponse.ok) {
        const spatialData: IndividualLandmarkRecord[] = await spatialResponse.json();
        
        for (const record of spatialData) {
          if (record.the_geom) {
            const geom = record.the_geom;
            const point: [number, number] = [lon, lat];
            
            if (geom.type === 'Point') {
              // For point geometries, we already matched via within_circle
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

    return { isLandmark: false };
  } catch (error) {
    console.warn('Individual landmark lookup failed:', error);
    throw error; // Re-throw to signal unknown status
  }
}

/**
 * Query Historic Districts dataset using spatial query
 */
async function checkHistoricDistrict(
  lat?: number,
  lon?: number
): Promise<{ inDistrict: boolean; districtName?: string }> {
  if (lat === undefined || lon === undefined) {
    return { inDistrict: false };
  }

  try {
    // Use Socrata's within_circle to find nearby districts, then do point-in-polygon
    // Historic districts are polygons, so we query those that might contain our point
    const url = `${SOCRATA_BASE}/${HISTORIC_DISTRICTS_DATASET}.json?$where=within_circle(the_geom,${lat},${lon},500)&$limit=20`;
    
    const response = await fetchWithTimeout(url, TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`Historic district query failed: ${response.status}`);
    }

    const data: HistoricDistrictRecord[] = await response.json();
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

    return { inDistrict: false };
  } catch (error) {
    console.warn('Historic district lookup failed:', error);
    throw error; // Re-throw to signal unknown status
  }
}

/**
 * Main landmark status lookup function
 */
export async function getLandmarkStatus(args: {
  bbl: string;
  lat?: number;
  lon?: number;
}): Promise<LandmarkResult> {
  const { bbl, lat, lon } = args;
  
  let individualResult: { isLandmark: boolean; name?: string; date?: string } | null = null;
  let districtResult: { inDistrict: boolean; districtName?: string } | null = null;
  let hasError = false;

  // Run both queries in parallel
  const [individualOutcome, districtOutcome] = await Promise.allSettled([
    checkIndividualLandmark(bbl, lat, lon),
    checkHistoricDistrict(lat, lon),
  ]);

  if (individualOutcome.status === 'fulfilled') {
    individualResult = individualOutcome.value;
  } else {
    console.warn('Individual landmark check failed:', individualOutcome.reason);
    hasError = true;
  }

  if (districtOutcome.status === 'fulfilled') {
    districtResult = districtOutcome.value;
  } else {
    console.warn('Historic district check failed:', districtOutcome.reason);
    hasError = true;
  }

  // Determine final status
  const isIndividual = individualResult?.isLandmark ?? false;
  const isHistoricDistrict = districtResult?.inDistrict ?? false;

  // If both queries failed, status is unknown
  if (individualResult === null && districtResult === null) {
    return {
      status: 'unknown',
      isIndividual: false,
      isHistoricDistrict: false,
      source: 'unknown',
    };
  }

  // If at least one succeeded, we can determine status
  const isLandmarked = isIndividual || isHistoricDistrict;

  return {
    status: isLandmarked ? 'yes' : (hasError ? 'unknown' : 'no'),
    isIndividual,
    isHistoricDistrict,
    individualName: individualResult?.name,
    individualDate: individualResult?.date,
    districtName: districtResult?.districtName,
    source: 'lpc',
  };
}
