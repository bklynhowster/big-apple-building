/**
 * Ownership Classification Helper
 * 
 * Computes ownership type with confidence and evidence based on available property data.
 * This replaces the hard "Co-op" assertion with a tiered confidence model.
 * 
 * IMPORTANT: DOF building classification (e.g., "CO-WALK-UP APARTMENT") reflects tax status,
 * NOT legal ownership structure. DOB explicitly warns about this distinction.
 */

export type OwnershipConfidence = 'high' | 'medium' | 'low';

export interface OwnershipProfile {
  ownershipTypeLabel: string;
  ownershipConfidence: OwnershipConfidence;
  ownershipEvidence: string[];
  ownershipWarnings: string[];
}

interface PropertyData {
  buildingClass?: string | null;
  landUse?: string | null;
  condoNo?: string | number | null;
  residentialUnits?: number | null;
  totalUnits?: number | null;
  hasMultipleUnitBBLs?: boolean;
  unitBBLCount?: number;
}

// Condo building classes: R0-R9, RR, RS
const CONDO_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'RR', 'RS'];

// Building classes that MAY indicate co-op (but are NOT definitive):
// C0-C9: Walk-up apartments (tax classification)
// D0-D9: Elevator apartments (tax classification)
// These reflect DOF tax classification, NOT legal ownership structure
const COOP_TAX_CLASS_PREFIXES = ['C', 'D'];

/**
 * Computes ownership profile with confidence level and evidence.
 * 
 * Rules (conservative):
 * A) High confidence Condo: condoNo present OR condo building class OR multiple unit BBLs
 * B) Medium confidence "Likely Co-op": DOF class starts with C/D, no condo indicators
 * C) Low confidence: Everything else
 */
export function computeOwnershipProfile(data: PropertyData): OwnershipProfile {
  const bc = (data.buildingClass || '').toUpperCase().trim();
  const condoNo = data.condoNo;
  const hasMultipleUnitBBLs = data.hasMultipleUnitBBLs || false;
  const unitBBLCount = data.unitBBLCount || 0;

  const evidence: string[] = [];
  const warnings: string[] = [];

  // ============ A) HIGH CONFIDENCE: Condominium ============
  
  // Check for explicit condo building class
  const isCondoClass = CONDO_CLASSES.some(c => bc.startsWith(c));
  if (isCondoClass) {
    evidence.push(`Building Class: ${bc} (condo class)`);
  }

  // Check for condo number
  const hasCondoNo = condoNo !== null && condoNo !== undefined && 
    String(condoNo).trim() !== '' && String(condoNo) !== '0';
  if (hasCondoNo) {
    evidence.push(`Condo Number: ${condoNo}`);
  }

  // Check for multiple unit BBLs
  if (hasMultipleUnitBBLs) {
    evidence.push(`Multiple unit BBLs present (${unitBBLCount} units)`);
  }

  // If ANY condo indicator is present → high confidence Condominium
  if (isCondoClass || hasCondoNo || hasMultipleUnitBBLs) {
    return {
      ownershipTypeLabel: 'Condominium',
      ownershipConfidence: 'high',
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // ============ B) MEDIUM CONFIDENCE: Likely Co-op (DOF tax classification) ============
  
  // Check if building class starts with C or D (DOF tax classification for apartments)
  const bcFirstChar = bc.charAt(0);
  const isCoopTaxClass = COOP_TAX_CLASS_PREFIXES.includes(bcFirstChar) && bc.length >= 2;
  
  if (isCoopTaxClass) {
    evidence.push(`DOF Building Classification: ${bc}`);
    warnings.push(
      'DOB notes that DOF classification reflects tax status and may not confirm legal ownership structure. ' +
      'Confirm via offering plan or corporate records if needed.'
    );

    return {
      ownershipTypeLabel: 'Likely Co-op (DOF tax classification)',
      ownershipConfidence: 'medium',
      ownershipEvidence: evidence,
      ownershipWarnings: warnings,
    };
  }

  // ============ C) LOW CONFIDENCE: Indeterminate ============
  
  // Collect whatever evidence we have
  if (bc) {
    evidence.push(`Building Class: ${bc}`);
  } else {
    evidence.push('Building Class: Not available');
  }

  if (condoNo === null || condoNo === undefined || String(condoNo).trim() === '' || String(condoNo) === '0') {
    evidence.push('Condo indicator: No');
  }

  if (!hasMultipleUnitBBLs) {
    evidence.push('Unit BBLs: None detected');
  }

  if (data.landUse) {
    evidence.push(`Land Use: ${data.landUse}`);
  }

  return {
    ownershipTypeLabel: 'Ownership type: Indeterminate',
    ownershipConfidence: 'low',
    ownershipEvidence: evidence,
    ownershipWarnings: [],
  };
}

/**
 * Returns a display-friendly label for the ownership type.
 * For high-confidence condos, just shows "Condominium".
 * For medium-confidence co-ops, shows the full qualified label.
 * For low-confidence, shows "Indeterminate".
 */
export function getOwnershipDisplayLabel(profile: OwnershipProfile): string {
  return profile.ownershipTypeLabel;
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
