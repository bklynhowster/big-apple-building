/**
 * Two-Layer Ownership Classification
 * 
 * SECTION A: Municipal Ownership (NYC data)
 * - ONLY reflects explicit NYC municipal dataset indicators
 * - NO building class inference, NO CO strings, NO heuristics
 * - Output: "Condominium" (only if explicit) or "Ownership type not specified in municipal data"
 * 
 * SECTION B: Ownership Structure (External / Verification)
 * - Uses external sources: ACRIS, offering plans, sales records, corporate filings
 * - Output: "Confirmed: [type]", "Likely: [type]", or "Unverified"
 */

// ============ SECTION A: Municipal Classification ============

export type MunicipalOwnershipLabel = 
  | 'Condominium'
  | 'Ownership type not specified in municipal data';

export interface MunicipalClassification {
  label: MunicipalOwnershipLabel;
  evidence: string[];
  source: string;
}

// ============ SECTION B: Ownership Structure ============

export type OwnershipConfidenceLevel = 'Confirmed' | 'Market-known' | 'Unverified';

export type OwnershipStructureType = 
  | 'Condominium'
  | 'Cooperative'
  | 'Rental'
  | 'Owner-Occupied'
  | 'Unknown';

export interface OwnershipStructure {
  type: OwnershipStructureType;
  confidence: OwnershipConfidenceLevel;
  evidence: string[];
  sources: string[];
}

// ============ Combined Profile ============

export interface OwnershipProfile {
  municipal: MunicipalClassification;
  ownership: OwnershipStructure;
  warnings: string[];
}

export interface PropertyData {
  buildingClass?: string | null;
  landUse?: string | null;
  condoNo?: string | number | null;
  residentialUnits?: number | null;
  totalUnits?: number | null;
  // These are NOT used for municipal classification per strict rules
  hasMultipleUnitBBLs?: boolean;
  unitBBLCount?: number;
  // External ownership indicators (Section B only)
  acrisCoopIndicator?: boolean;
  acrisCoopSource?: string;
  offeringPlanType?: 'cooperative' | 'condominium' | null;
  salesRecordType?: 'cooperative' | 'condominium' | null;
}

/**
 * SECTION A: Municipal Classification
 * 
 * STRICT RULES:
 * - Do NOT use building class codes (e.g., C0, D4, R0-R9) to infer ownership
 * - Do NOT use "CO" strings or certificate-of-occupancy references
 * - Do NOT use unit count, BBL patterns, or anything heuristic
 * - Only show "Condominium" if an NYC dataset EXPLICITLY indicates it (e.g., condoNo field)
 */
function computeMunicipalClassification(data: PropertyData): MunicipalClassification {
  const condoNo = data.condoNo;
  const bc = (data.buildingClass || '').toUpperCase().trim();
  const evidence: string[] = [];

  // ONLY explicit condo indicator: condoNo field is set
  // Per strict rules: Do NOT use building class codes to infer condo/co-op
  const hasExplicitCondoNo = condoNo !== null && condoNo !== undefined && 
    String(condoNo).trim() !== '' && String(condoNo) !== '0';

  if (hasExplicitCondoNo) {
    evidence.push(`Condo Number: ${condoNo} (explicit municipal indicator)`);
    
    return {
      label: 'Condominium',
      evidence,
      source: 'NYC DOF (Department of Finance)',
    };
  }

  // Default: not specified in municipal data
  // Include available data for transparency but do NOT use for inference
  if (bc) evidence.push(`Building Class: ${bc} (not used for ownership inference)`);
  if (data.landUse) evidence.push(`Land Use: ${data.landUse}`);
  if (data.residentialUnits) evidence.push(`Residential Units: ${data.residentialUnits}`);

  return {
    label: 'Ownership type not specified in municipal data',
    evidence: evidence.length > 0 ? evidence : ['No explicit ownership indicators in municipal data'],
    source: 'NYC PLUTO/DOB',
  };
}

/**
 * SECTION B: Ownership Structure (External / Verification)
 * 
 * STRICT RULES:
 * - Only use external sources: ACRIS, offering plans, sales records, corporate filings
 * - Never infer co-op from DOB, PLUTO, CO status, building class, or any municipal-only fields
 * - If no external evidence, show "Unverified"
 */
function computeOwnershipStructure(
  data: PropertyData, 
  municipal: MunicipalClassification
): OwnershipStructure {
  const sources: string[] = [];
  const evidence: string[] = [];

  // If municipal explicitly says Condominium (via condoNo), that's confirmed
  if (municipal.label === 'Condominium') {
    return {
      type: 'Condominium',
      confidence: 'Confirmed',
      evidence: ['Condo number registered with NYC Department of Finance'],
      sources: ['NYC DOF'],
    };
  }

  // Check external cooperative indicators
  if (data.acrisCoopIndicator && data.acrisCoopSource) {
    sources.push('ACRIS');
    evidence.push(data.acrisCoopSource);
    
    return {
      type: 'Cooperative',
      confidence: 'Confirmed',
      evidence,
      sources,
    };
  }

  if (data.offeringPlanType === 'cooperative') {
    sources.push('Offering Plan');
    evidence.push('Cooperative offering plan on file');
    
    return {
      type: 'Cooperative',
      confidence: 'Confirmed',
      evidence,
      sources,
    };
  }

  if (data.offeringPlanType === 'condominium') {
    sources.push('Offering Plan');
    evidence.push('Condominium offering plan on file');
    
    return {
      type: 'Condominium',
      confidence: 'Confirmed',
      evidence,
      sources,
    };
  }

  if (data.salesRecordType === 'cooperative') {
    sources.push('Sales Records');
    evidence.push('Property sold as cooperative unit');
    
    return {
      type: 'Cooperative',
      confidence: 'Market-known',
      evidence,
      sources,
    };
  }

  if (data.salesRecordType === 'condominium') {
    sources.push('Sales Records');
    evidence.push('Property sold as condominium unit');
    
    return {
      type: 'Condominium',
      confidence: 'Market-known',
      evidence,
      sources,
    };
  }

  // No external indicators available
  return {
    type: 'Unknown',
    confidence: 'Unverified',
    evidence: [],
    sources: [],
  };
}

/**
 * Computes complete two-layer ownership profile.
 */
export function computeOwnershipProfile(data: PropertyData): OwnershipProfile {
  const municipal = computeMunicipalClassification(data);
  const ownership = computeOwnershipStructure(data, municipal);

  const warnings: string[] = [];

  // Add DOB/PLUTO limitation warning when ownership is unverified
  if (ownership.confidence === 'Unverified') {
    warnings.push(
      'DOB and PLUTO data do not reliably indicate cooperative ownership.'
    );
  }

  return {
    municipal,
    ownership,
    warnings,
  };
}

/**
 * Returns CSS classes for styling based on confidence level.
 */
export function getConfidenceStyles(confidence: OwnershipConfidenceLevel): {
  badge: string;
  text: string;
} {
  switch (confidence) {
    case 'Confirmed':
      return {
        badge: 'bg-accent text-accent-foreground',
        text: 'text-accent-foreground',
      };
    case 'Market-known':
      return {
        badge: 'bg-warning/10 text-warning border border-warning/20',
        text: 'text-warning',
      };
    case 'Unverified':
      return {
        badge: 'bg-muted text-muted-foreground',
        text: 'text-muted-foreground',
      };
  }
}

// Legacy export for backward compatibility
export type OwnershipConfidence = 'high' | 'medium' | 'low';

export function getOwnershipConfidenceStyles(confidence: OwnershipConfidence): {
  badge: string;
  icon: string;
} {
  switch (confidence) {
    case 'high':
      return {
        badge: 'bg-accent text-accent-foreground',
        icon: 'text-accent-foreground',
      };
    case 'medium':
      return {
        badge: 'bg-warning/10 text-warning border border-warning/20',
        icon: 'text-warning',
      };
    case 'low':
      return {
        badge: 'bg-muted text-muted-foreground',
        icon: 'text-muted-foreground',
      };
  }
}
