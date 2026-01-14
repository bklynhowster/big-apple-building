/**
 * Ownership Classification Helper
 * 
 * Determines property ownership type CONSERVATIVELY.
 * 
 * CRITICAL RULES:
 * - "CO", "CO-" in DOB/BIS data refers to Certificate of Occupancy, NOT cooperative ownership
 * - Do NOT infer cooperative from DOB Property Profile, CO status, or Building Class
 * - Do NOT infer cooperative from absence of condo units
 * - Only assert "Cooperative" with explicit ownership records (sales, ACRIS, offering plan)
 */

export type OwnershipLabel = 
  | 'Condominium'
  | 'Cooperative'
  | 'Ownership type not specified in municipal data';

export type OwnershipConfidence = 'high' | 'medium' | 'low';

export interface OwnershipProfile {
  ownershipTypeLabel: OwnershipLabel;
  ownershipConfidence: OwnershipConfidence;
  ownershipEvidence: string[];
  ownershipWarnings: string[];
}

export interface PropertyData {
  buildingClass?: string | null;
  landUse?: string | null;
  condoNo?: string | number | null;
  residentialUnits?: number | null;
  totalUnits?: number | null;
  hasMultipleUnitBBLs?: boolean;
  unitBBLCount?: number;
  // Explicit ownership indicators from authoritative sources
  explicitCoopIndicator?: boolean; // From sales records, ACRIS, offering plan
  explicitCoopSource?: string; // Description of source
}

// Condo building classes: R0-R9, RR, RS
const CONDO_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'RR', 'RS'];

/**
 * Computes ownership profile CONSERVATIVELY.
 * 
 * CLASSIFICATION LOGIC:
 * 1) If condo unit BBL pattern exists OR explicit condominium indicator exists:
 *    => "Condominium"
 * 
 * 2) If explicit cooperative ownership indicator exists in authoritative sources
 *    (sales record marked "COOPERATIVE", ACRIS cooperative corporation, offering plan):
 *    => "Cooperative"
 * 
 * 3) Else:
 *    => "Ownership type not specified in municipal data"
 * 
 * NEVER infer cooperative from:
 * - "CO" or "CO-" text (Certificate of Occupancy)
 * - Building class codes (C0-C9, D0-D9)
 * - Absence of condo units
 * - DOB Property Profile data
 */
export function computeOwnershipProfile(data: PropertyData): OwnershipProfile {
  const bc = (data.buildingClass || '').toUpperCase().trim();
  const condoNo = data.condoNo;
  const hasMultipleUnitBBLs = data.hasMultipleUnitBBLs || false;
  const unitBBLCount = data.unitBBLCount || 0;

  const evidence: string[] = [];
  const warnings: string[] = [];

  // ============ 1) CONDOMINIUM DETECTION ============
  const isCondoClass = CONDO_CLASSES.some(c => bc.startsWith(c));
  const hasCondoNo = condoNo !== null && condoNo !== undefined && 
    String(condoNo).trim() !== '' && String(condoNo) !== '0';

  // Condo via unit BBLs (strongest indicator)
  if (hasMultipleUnitBBLs && unitBBLCount > 0) {
    evidence.push(`Multiple unit BBLs present (${unitBBLCount} units)`);
    if (isCondoClass) evidence.push(`Building Class: ${bc} (condo class)`);
    if (hasCondoNo) evidence.push(`Condo Number: ${condoNo}`);
    
    return {
      ownershipTypeLabel: 'Condominium',
      ownershipConfidence: 'high',
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // Condo via class or condo number
  if (isCondoClass || hasCondoNo) {
    if (isCondoClass) evidence.push(`Building Class: ${bc} (condo class)`);
    if (hasCondoNo) evidence.push(`Condo Number: ${condoNo}`);
    
    return {
      ownershipTypeLabel: 'Condominium',
      ownershipConfidence: 'high',
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // ============ 2) COOPERATIVE - ONLY WITH EXPLICIT EVIDENCE ============
  if (data.explicitCoopIndicator && data.explicitCoopSource) {
    evidence.push(`Explicit cooperative indicator: ${data.explicitCoopSource}`);
    
    return {
      ownershipTypeLabel: 'Cooperative',
      ownershipConfidence: 'high',
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // ============ 3) DEFAULT: NOT SPECIFIED ============
  // Collect diagnostic info for transparency
  if (bc) evidence.push(`Building Class: ${bc}`);
  if (data.landUse) evidence.push(`Land Use: ${data.landUse}`);
  if (data.residentialUnits) evidence.push(`Residential Units: ${data.residentialUnits}`);

  // Always add the helper warning
  warnings.push(
    'DOB and PLUTO data do not reliably indicate cooperative ownership. ' +
    'Confirm via offering plan, ACRIS records, or corporation filings.'
  );

  return {
    ownershipTypeLabel: 'Ownership type not specified in municipal data',
    ownershipConfidence: 'low',
    ownershipEvidence: evidence.length > 0 ? evidence : ['No ownership indicators found'],
    ownershipWarnings: warnings,
  };
}

/**
 * Returns CSS classes for styling based on confidence level.
 */
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
