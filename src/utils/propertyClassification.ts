/**
 * Client-side property classification engine.
 *
 * Fetches PLUTO data from NYC Open Data and classifies buildings
 * as Condo, Co-op, or other property types.
 *
 * Replaces the Supabase property-profile edge function.
 */

import type {
  PropertyProfile,
  PropertyTypeLabel,
  PropertyTenure,
  MunicipalClassification,
  OwnershipStructure,
  OwnershipStructureType,
  OwnershipConfidenceLevel,
  InferredConfidenceLevel,
} from '@/hooks/usePropertyProfile';

// ─── Constants ───

const PLUTO_DATASET_ID = '64uk-42ks';
const PLUTO_BASE_URL = `https://data.cityofnewyork.us/resource/${PLUTO_DATASET_ID}.json`;

// DOF official condo building classes
const CONDO_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'RR', 'RS'];
const ONE_TWO_FAMILY_CLASSES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'B1', 'B2', 'B3', 'B9'];
const MIXED_USE_LAND_USES = ['04'];
const COMMERCIAL_LAND_USES = ['05', '06', '07', '08', '09', '10', '11'];

// DOF official co-op building classes — definitive municipal classifications
// D4: Elevator Co-op, C6: Walk-Up Co-op, C8: Walk-Up Co-op (converted)
const COOP_DEFINITIVE_CLASSES = ['D4', 'C6', 'C8'];
// Common for co-ops but not definitive — expanded based on NYC data analysis:
// D0/D6-D9: elevator apartments often used as co-ops
// C0-C5,C7,C9: walk-up variants (converted lofts, old-law tenements, etc.)
// D1: elevator with stores (many co-ops have ground-floor commercial)
// RM: condo/co-op in DOF records (often HDFCs misclassified)
const COOP_INDICATOR_CLASSES = ['D0', 'D1', 'D6', 'D7', 'D8', 'D9',
  'C0', 'C1', 'C2', 'C3', 'C5', 'C7', 'C9', 'RM'];

// Owner name patterns indicating a cooperative corporation
// Note: PLUTO truncates ownername, so "OWNERS CORP" may appear as "OWNERS C"
const COOP_OWNER_PATTERNS = [
  /OWNERS?\s*CORP/i,
  /OWNERS?\s*C$/i,             // truncated "OWNERS CORP"
  /HOUSING\s*CORP/i,
  /HOUSING\s*DEVELOP/i,        // truncated "HOUSING DEVELOPMENT FUND CORP" (HDFC)
  /TE?NNANTS?\s*CORP/i,        // includes misspelling "TENNANTS"
  /TENANTS?\s*C$/i,            // truncated
  /COOPERATIVE/i,
  /\bCO[\-\s]?OP\b/i,
  /\bHDFC\b/i,
  /MUTUAL\s*HOUSING/i,
  /APARTMENT\s*CORP/i,
  /\bAPT\s*CORP/i,
];

// PLUTO column name candidates (handles schema changes)
const COLUMN_MAP: Record<string, string[]> = {
  bbl: ['bbl'],
  borough: ['borough', 'boro', 'borocode'],
  block: ['block'],
  lot: ['lot'],
  landUse: ['landuse', 'land_use'],
  buildingClass: ['bldgclass', 'building_class', 'buildingclass'],
  unitsRes: ['unitsres', 'units_res', 'residentialunits', 'residential_units'],
  unitsTotal: ['unitstotal', 'units_total', 'totalunits', 'total_units'],
  yearBuilt: ['yearbuilt', 'year_built', 'yrbuilt'],
  grossSqFt: ['bldgarea', 'building_area', 'grosssqft', 'gross_sqft', 'grossarea'],
  lotArea: ['lotarea', 'lot_area', 'landarea'],
  condoNo: ['condono', 'condo_no', 'condonumber'],
  address: ['address', 'addr'],
  ownerName: ['ownername', 'owner_name'],
  numFloors: ['numfloors', 'num_floors', 'floors'],
  zipCode: ['zipcode', 'zip_code', 'zip'],
};

// ─── Helpers ───

const BOROUGH_NAMES: Record<string, string> = {
  '1': 'Manhattan', '2': 'Bronx', '3': 'Brooklyn', '4': 'Queens', '5': 'Staten Island',
};

function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

function resolveColumn(raw: Record<string, unknown>, key: string): unknown {
  const candidates = COLUMN_MAP[key];
  if (!candidates) return null;
  for (const col of candidates) {
    const lc = col.toLowerCase();
    // Check exact match first, then case-insensitive
    if (raw[col] !== undefined) return raw[col];
    for (const k of Object.keys(raw)) {
      if (k.toLowerCase() === lc) return raw[k];
    }
  }
  return null;
}

function isCoopOwnerName(name: string | null): boolean {
  if (!name) return false;
  return COOP_OWNER_PATTERNS.some(p => p.test(name.toUpperCase()));
}

// ─── Classification Logic ───

function classifyPropertyType(
  buildingClass: string | null,
  landUse: string | null,
  unitsRes: number | null,
  condoNo: string | number | null,
  ownerName: string | null,
): { propertyTypeLabel: PropertyTypeLabel; propertyTenure: PropertyTenure } {
  const bc = (buildingClass || '').toUpperCase().trim();
  const lu = (landUse || '').trim();

  // Condo detection (hard data)
  if (CONDO_CLASSES.some(c => bc.startsWith(c))) {
    return { propertyTypeLabel: 'Condo', propertyTenure: 'CONDO' };
  }
  if (condoNo && String(condoNo).trim() !== '' && String(condoNo) !== '0') {
    return { propertyTypeLabel: 'Condo', propertyTenure: 'CONDO' };
  }

  // Co-op detection: definitive building class OR indicator class + owner name
  if (COOP_DEFINITIVE_CLASSES.some(c => bc.startsWith(c))) {
    return { propertyTypeLabel: 'Co-op', propertyTenure: 'COOP' };
  }
  if (isCoopOwnerName(ownerName) && (unitsRes === null || unitsRes >= 3)) {
    return { propertyTypeLabel: 'Co-op', propertyTenure: 'COOP' };
  }
  // Soft indicator class + multi-unit suggests co-op (even without owner name match)
  if (COOP_INDICATOR_CLASSES.some(c => bc.startsWith(c)) && unitsRes !== null && unitsRes >= 10) {
    return { propertyTypeLabel: 'Co-op', propertyTenure: 'COOP' };
  }

  if (COMMERCIAL_LAND_USES.includes(lu)) {
    return { propertyTypeLabel: 'Commercial', propertyTenure: 'RENTAL_OR_OTHER' };
  }
  if (MIXED_USE_LAND_USES.includes(lu)) {
    return { propertyTypeLabel: 'Mixed-Use', propertyTenure: 'RENTAL_OR_OTHER' };
  }
  if (ONE_TWO_FAMILY_CLASSES.some(c => bc.startsWith(c))) {
    return { propertyTypeLabel: '1-2 Family', propertyTenure: 'RENTAL_OR_OTHER' };
  }
  if (unitsRes !== null) {
    if (unitsRes <= 2) return { propertyTypeLabel: '1-2 Family', propertyTenure: 'RENTAL_OR_OTHER' };
    if (unitsRes >= 3) return { propertyTypeLabel: '3+ Family', propertyTenure: 'RENTAL_OR_OTHER' };
  }
  if (lu === '01') return { propertyTypeLabel: '1-2 Family', propertyTenure: 'RENTAL_OR_OTHER' };
  if (lu === '02' || lu === '03') return { propertyTypeLabel: '3+ Family', propertyTenure: 'RENTAL_OR_OTHER' };

  return { propertyTypeLabel: 'Unknown', propertyTenure: 'UNKNOWN' };
}

function computeMunicipalClassification(
  condoNo: string | number | null,
  buildingClass: string | null,
  landUse: string | null,
  residentialUnits: number | null,
  ownerName: string | null,
): MunicipalClassification {
  const bc = (buildingClass || '').toUpperCase().trim();
  const evidence: string[] = [];

  const hasExplicitCondoNo = condoNo !== null && condoNo !== undefined &&
    String(condoNo).trim() !== '' && String(condoNo) !== '0';

  if (hasExplicitCondoNo) {
    evidence.push(`Condo Number: ${condoNo} (explicit municipal indicator)`);
    return { label: 'Condominium', evidence, source: 'NYC DOF (Department of Finance)' };
  }

  // DOF definitive co-op building classes
  if (COOP_DEFINITIVE_CLASSES.some(c => bc.startsWith(c))) {
    evidence.push(`Building Class: ${bc} (DOF cooperative classification)`);
    if (ownerName) evidence.push(`Owner: ${ownerName}`);
    if (residentialUnits) evidence.push(`Residential Units: ${residentialUnits}`);
    return { label: 'Ownership type not specified in municipal data', evidence, source: 'NYC DOF (Department of Finance)' };
  }

  if (bc) evidence.push(`Building Class: ${bc}`);
  if (landUse) evidence.push(`Land Use: ${landUse}`);
  if (residentialUnits) evidence.push(`Residential Units: ${residentialUnits}`);
  if (ownerName) evidence.push(`Owner: ${ownerName}`);

  return {
    label: 'Ownership type not specified in municipal data',
    evidence: evidence.length > 0 ? evidence : ['No explicit ownership indicators in municipal data'],
    source: 'NYC PLUTO/DOB',
  };
}

function computeOwnershipStructure(
  condoNo: string | number | null,
  buildingClass: string | null,
  unitsRes: number | null,
  ownerName: string | null,
): OwnershipStructure {
  const bc = (buildingClass || '').toUpperCase().trim();
  const indicators: string[] = [];
  let score = 0;

  // HARD BLOCK: condo
  const hasCondoFlag = condoNo !== null && condoNo !== undefined &&
    String(condoNo).trim() !== '' && String(condoNo) !== '0';
  if (hasCondoFlag) {
    return {
      type: 'Condominium' as OwnershipStructureType,
      confidence: 'Confirmed' as OwnershipConfidenceLevel,
      inferredConfidence: 'High' as InferredConfidenceLevel,
      coopLikelihoodScore: 0,
      indicators: ['Municipal condo flag detected'],
      sources: ['NYC DOF'],
      disclaimerKey: 'unverified',
    };
  }

  const units = unitsRes ?? 0;

  // Signal 1: Definitive DOF co-op building class (+8)
  if (COOP_DEFINITIVE_CLASSES.some(c => bc.startsWith(c))) {
    score += 8;
    indicators.push(`Building class ${bc} — DOF cooperative classification`);
  }

  // Signal 2: Owner name matches co-op corporation patterns (+6)
  if (isCoopOwnerName(ownerName)) {
    score += 6;
    indicators.push(`Owner "${ownerName}" matches cooperative corporation pattern`);
  }

  // Signal 3: Soft co-op building class (+4)
  // Many co-ops use non-standard building classes (C0-C5, C7, C9, D1, RM)
  if (!COOP_DEFINITIVE_CLASSES.some(c => bc.startsWith(c)) &&
      COOP_INDICATOR_CLASSES.some(c => bc.startsWith(c))) {
    score += 4;
    indicators.push(`Building class ${bc} is common for co-ops`);
  }

  // Signal 4: Large building on single tax lot (+2)
  if (units >= 10) {
    score += 2;
    indicators.push(`${units} residential units on a single tax lot`);
  }

  // Signal 5: Multi-unit with no condo indicators (+2)
  if (units >= 3 && !hasCondoFlag) {
    score += 2;
    indicators.push('Multi-unit building with no condo BBL splits');
  }

  // CAP: Small buildings (≤2 units) are almost never co-ops
  if (units > 0 && units <= 2) {
    score = Math.min(score, 3);
    indicators.push('Small building (≤2 units) — score capped');
  }

  score = Math.min(score, 10);

  if (score >= 8) {
    return {
      type: 'Cooperative' as OwnershipStructureType,
      confidence: 'Confirmed' as OwnershipConfidenceLevel,
      inferredConfidence: 'High' as InferredConfidenceLevel,
      coopLikelihoodScore: score,
      indicators,
      sources: ['NYC DOF building classification', 'PLUTO'],
      disclaimerKey: 'market-known',
    };
  }

  if (score >= 5) {
    return {
      type: 'Cooperative' as OwnershipStructureType,
      confidence: 'Market-known' as OwnershipConfidenceLevel,
      inferredConfidence: 'Medium' as InferredConfidenceLevel,
      coopLikelihoodScore: score,
      indicators,
      sources: ['Structural analysis'],
      disclaimerKey: 'market-known',
    };
  }

  return {
    type: 'Unknown' as OwnershipStructureType,
    confidence: 'Unverified' as OwnershipConfidenceLevel,
    inferredConfidence: 'Low' as InferredConfidenceLevel,
    coopLikelihoodScore: score,
    indicators: indicators.length > 0 ? indicators : ['Insufficient structural evidence'],
    sources: [],
    disclaimerKey: 'unverified',
  };
}

// ─── Main Fetch + Classify ───

export async function fetchPropertyProfile(
  bbl: string,
  signal?: AbortSignal,
): Promise<PropertyProfile> {
  const url = new URL(PLUTO_BASE_URL);
  url.searchParams.set('bbl', bbl);

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`PLUTO API returned ${response.status}`);
  }

  const records = await response.json() as Record<string, unknown>[];
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`No property found for BBL ${bbl}`);
  }

  const raw = records[0];

  // Resolve columns
  const buildingClass = resolveColumn(raw, 'buildingClass') as string | null;
  const landUse = resolveColumn(raw, 'landUse') as string | null;
  const unitsRes = parseNumber(resolveColumn(raw, 'unitsRes'));
  const condoNoRaw = resolveColumn(raw, 'condoNo');
  const condoNo = (condoNoRaw !== null && condoNoRaw !== undefined)
    ? (typeof condoNoRaw === 'string' || typeof condoNoRaw === 'number' ? condoNoRaw : null)
    : null;
  const ownerName = resolveColumn(raw, 'ownerName') as string | null;

  // Classify
  const { propertyTypeLabel, propertyTenure } = classifyPropertyType(
    buildingClass, landUse, unitsRes, condoNo, ownerName,
  );
  const municipal = computeMunicipalClassification(
    condoNo, buildingClass, landUse, unitsRes, ownerName,
  );
  const ownership = computeOwnershipStructure(
    condoNo, buildingClass, unitsRes, ownerName,
  );

  const ownershipWarnings: string[] = [];
  if (ownership.confidence === 'Unverified') {
    ownershipWarnings.push('DOB and PLUTO data do not reliably indicate cooperative ownership.');
  }

  const fieldsUsed = Object.keys(COLUMN_MAP)
    .map(key => {
      const candidates = COLUMN_MAP[key];
      for (const col of candidates) {
        for (const k of Object.keys(raw)) {
          if (k.toLowerCase() === col.toLowerCase()) return k;
        }
      }
      return null;
    })
    .filter((c): c is string => c !== null);

  return {
    bbl,
    borough: BOROUGH_NAMES[bbl.charAt(0)] || null,
    block: bbl.slice(1, 6).replace(/^0+/, '') || '0',
    lot: bbl.slice(6, 10).replace(/^0+/, '') || '0',
    address: resolveColumn(raw, 'address') as string | null,
    landUse,
    buildingClass,
    propertyTypeLabel,
    propertyTenure,
    municipal,
    ownership,
    ownershipWarnings,
    residentialUnits: unitsRes,
    totalUnits: parseNumber(resolveColumn(raw, 'unitsTotal')),
    yearBuilt: parseNumber(resolveColumn(raw, 'yearBuilt')),
    grossSqFt: parseNumber(resolveColumn(raw, 'grossSqFt')),
    lotArea: parseNumber(resolveColumn(raw, 'lotArea')),
    numFloors: parseNumber(resolveColumn(raw, 'numFloors')),
    zipCode: resolveColumn(raw, 'zipCode') as string | null,
    ownerName,
    source: { datasetId: PLUTO_DATASET_ID, fieldsUsed },
    raw,
    requestId: `client-${Date.now().toString(36)}`,
  };
}
