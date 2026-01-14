/**
 * Ownership Classification Helper
 * 
 * Computes ownership type with confidence and evidence based on available property data.
 * Uses STRICT assertion-only logic - only claims co-op if explicit text evidence exists.
 * 
 * IMPORTANT: DOF building classification codes (C0-C9, D0-D9) do NOT confirm co-op ownership.
 * These are tax classifications for apartment buildings, shared by rentals and co-ops alike.
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
  rawTextFields?: string[]; // Any text fields to check for explicit co-op wording
}

// Condo building classes: R0-R9, RR, RS
const CONDO_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'RR', 'RS'];

/**
 * Checks if text contains explicit co-op keywords (not just "CO-" prefix).
 * Only matches "COOPERATIVE", "CO-OP", "COOP" as distinct words.
 */
function hasExplicitCoopText(text: string | null | undefined): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  return /\bCOOPERATIVE\b/.test(upper) || 
         /\bCO-OP\b/.test(upper) || 
         /\bCOOP\b/.test(upper);
}

/**
 * Computes ownership profile with STRICT confidence level and evidence.
 * 
 * Rules (assertion only when explicit):
 * A) High confidence Condo: condoNo present OR condo building class OR multiple unit BBLs
 * B) High confidence Co-op: ONLY if explicit "Cooperative/Co-op" text exists
 * C) Otherwise: "Ownership type: Not specified in municipal data" (low confidence)
 * 
 * NOTE: We do NOT infer co-op from C/D building class codes. These are DOF tax
 * classifications shared by rental and co-op buildings alike.
 */
export function computeOwnershipProfile(data: PropertyData): OwnershipProfile {
  const bc = (data.buildingClass || '').toUpperCase().trim();
  const condoNo = data.condoNo;
  const hasMultipleUnitBBLs = data.hasMultipleUnitBBLs || false;
  const unitBBLCount = data.unitBBLCount || 0;

  const evidence: string[] = [];
  const warnings: string[] = [];

  // ============ A) HIGH CONFIDENCE: Condominium ============
  const isCondoClass = CONDO_CLASSES.some(c => bc.startsWith(c));
  if (isCondoClass) {
    evidence.push(`Building Class: ${bc} (condo class)`);
  }

  const hasCondoNo = condoNo !== null && condoNo !== undefined && 
    String(condoNo).trim() !== '' && String(condoNo) !== '0';
  if (hasCondoNo) {
    evidence.push(`Condo Number: ${condoNo}`);
  }

  if (hasMultipleUnitBBLs) {
    evidence.push(`Multiple unit BBLs present (${unitBBLCount} units)`);
  }

  if (isCondoClass || hasCondoNo || hasMultipleUnitBBLs) {
    return {
      ownershipTypeLabel: 'Condominium',
      ownershipConfidence: 'high',
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // ============ B) HIGH CONFIDENCE: Co-op (ONLY with explicit text) ============
  const textFieldsToCheck = data.rawTextFields || [];
  if (bc) textFieldsToCheck.push(bc);
  
  const hasExplicitCoop = textFieldsToCheck.some(text => hasExplicitCoopText(text));
  
  if (hasExplicitCoop) {
    evidence.push('Explicit "Cooperative" or "Co-op" text found in property data');
    if (bc) evidence.push(`Building Class: ${bc}`);
    
    return {
      ownershipTypeLabel: 'Co-op',
      ownershipConfidence: 'high',
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // ============ C) LOW CONFIDENCE: Not specified ============
  if (bc) {
    evidence.push(`Building Class: ${bc}`);
  } else {
    evidence.push('Building Class: Not available');
  }

  if (!hasCondoNo) {
    evidence.push('Condo indicator: No');
  }

  if (!hasMultipleUnitBBLs) {
    evidence.push('Unit BBLs: None detected');
  }

  if (data.landUse) {
    evidence.push(`Land Use: ${data.landUse}`);
  }

  // Add warning if building class might be misleading
  const bcFirstChar = bc.charAt(0);
  if ((bcFirstChar === 'C' || bcFirstChar === 'D') && bc.length >= 2) {
    warnings.push(
      `Building class ${bc} is a DOF tax classification for apartment buildings. ` +
      'This does NOT confirm cooperative ownership.'
    );
  }

  return {
    ownershipTypeLabel: 'Ownership type: Not specified in municipal data',
    ownershipConfidence: 'low',
    ownershipEvidence: evidence,
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
