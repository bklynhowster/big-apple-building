/**
 * Ownership Classification Helper
 * 
 * Computes ownership type with confidence score (0-100) based on available property data.
 * Uses STRICT rules - only claims co-op when explicit text evidence exists.
 * 
 * IMPORTANT: 
 * - "Condo=NO" is NOT evidence of co-op
 * - DOF building classification codes (C0-C9, D0-D9) do NOT confirm co-op ownership
 * - CO-* prefix is tax classification, NOT cooperative ownership
 */

export type OwnershipLabel = 
  | 'Condo'
  | 'Confirmed co-op'
  | 'Likely co-op'
  | 'Possible co-op (unconfirmed)'
  | 'Not a co-op'
  | 'Unknown / not specified';

export type OwnershipConfidence = 'high' | 'medium' | 'low';

export interface OwnershipProfile {
  ownershipTypeLabel: OwnershipLabel;
  ownershipConfidence: OwnershipConfidence;
  ownershipScore: number; // 0-100
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
  rawTextFields?: string[]; // Any text fields to check for explicit co-op wording
}

// Condo building classes: R0-R9, RR, RS
const CONDO_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'RR', 'RS'];

// Residential land uses
const RESIDENTIAL_LAND_USES = ['01', '02', '03', '04'];

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
 * Computes ownership profile with scoring system (0-100).
 * 
 * SCORING RULES:
 * - If unit BBLs exist → Force "Condo", score=100
 * - If condoNo or condo class → Force "Condo", score=100
 * - Explicit "Cooperative" or "Co-op" text from municipal data → +80
 * - Residential building, units > 10, NO unit BBLs → +20
 * 
 * LABEL MAPPING:
 * - score >= 80 with explicit text → "Confirmed co-op" or "Likely co-op"
 * - score 40-79 → "Possible co-op (unconfirmed)"
 * - else → "Unknown / not specified"
 * 
 * NEVER use "Condo=NO" as scoring input.
 */
export function computeOwnershipProfile(data: PropertyData): OwnershipProfile {
  const bc = (data.buildingClass || '').toUpperCase().trim();
  const condoNo = data.condoNo;
  const hasMultipleUnitBBLs = data.hasMultipleUnitBBLs || false;
  const unitBBLCount = data.unitBBLCount || 0;
  const residentialUnits = data.residentialUnits || 0;
  const landUse = (data.landUse || '').trim();

  const evidence: string[] = [];
  const warnings: string[] = [];

  // ============ CONDO DETECTION (highest priority) ============
  const isCondoClass = CONDO_CLASSES.some(c => bc.startsWith(c));
  const hasCondoNo = condoNo !== null && condoNo !== undefined && 
    String(condoNo).trim() !== '' && String(condoNo) !== '0';

  // If we have unit BBLs, it's definitely a condo, not a co-op
  if (hasMultipleUnitBBLs && unitBBLCount > 0) {
    evidence.push(`Multiple unit BBLs present (${unitBBLCount} units)`);
    if (isCondoClass) evidence.push(`Building Class: ${bc} (condo class)`);
    if (hasCondoNo) evidence.push(`Condo Number: ${condoNo}`);
    
    console.log('[OwnershipClassifier] Condo detected via unit BBLs', { unitBBLCount, bc, condoNo });
    
    return {
      ownershipTypeLabel: 'Condo',
      ownershipConfidence: 'high',
      ownershipScore: 100,
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // Condo via class or condo number
  if (isCondoClass || hasCondoNo) {
    if (isCondoClass) evidence.push(`Building Class: ${bc} (condo class)`);
    if (hasCondoNo) evidence.push(`Condo Number: ${condoNo}`);
    
    console.log('[OwnershipClassifier] Condo detected via class/condoNo', { bc, condoNo });
    
    return {
      ownershipTypeLabel: 'Condo',
      ownershipConfidence: 'high',
      ownershipScore: 100,
      ownershipEvidence: evidence,
      ownershipWarnings: [],
    };
  }

  // ============ CO-OP SCORING ============
  let score = 0;
  let hasExplicitCoopEvidence = false;

  // Check for explicit co-op text in raw fields
  const textFieldsToCheck = data.rawTextFields || [];
  if (bc) textFieldsToCheck.push(bc);
  
  const explicitCoopText = textFieldsToCheck.find(text => hasExplicitCoopText(text));
  
  if (explicitCoopText) {
    // +80 for explicit co-op text
    score += 80;
    hasExplicitCoopEvidence = true;
    evidence.push(`Explicit "Cooperative" or "Co-op" text found: "${explicitCoopText.substring(0, 50)}..."`);
    console.log('[OwnershipClassifier] Explicit co-op text found', { text: explicitCoopText.substring(0, 100) });
  }

  // +20 if residential with >10 units and NO unit BBLs
  const isResidential = RESIDENTIAL_LAND_USES.includes(landUse);
  if (isResidential && residentialUnits > 10 && !hasMultipleUnitBBLs) {
    score += 20;
    evidence.push(`Residential building with ${residentialUnits} units and no individual unit BBLs`);
    console.log('[OwnershipClassifier] +20 for residential >10 units, no unit BBLs', { residentialUnits, landUse });
  }

  // Collect diagnostic evidence
  if (bc) evidence.push(`Building Class: ${bc}`);
  if (landUse) evidence.push(`Land Use: ${landUse}`);
  if (residentialUnits > 0) evidence.push(`Residential Units: ${residentialUnits}`);

  // Add warning about DOF codes if applicable
  const bcFirstChar = bc.charAt(0);
  if ((bcFirstChar === 'C' || bcFirstChar === 'D') && bc.length >= 2) {
    warnings.push(
      `Building class ${bc} is a DOF tax classification for apartment buildings. ` +
      'This does NOT confirm cooperative ownership. Many rental buildings share these classifications.'
    );
  }

  console.log('[OwnershipClassifier] Score computed', { 
    score, 
    hasExplicitCoopEvidence, 
    residentialUnits, 
    hasMultipleUnitBBLs,
    bc,
    landUse 
  });

  // ============ LABEL MAPPING ============
  if (score >= 80 && hasExplicitCoopEvidence) {
    return {
      ownershipTypeLabel: 'Likely co-op',
      ownershipConfidence: 'high',
      ownershipScore: score,
      ownershipEvidence: evidence,
      ownershipWarnings: warnings,
    };
  }

  if (score >= 40) {
    warnings.push(
      'Based on municipal tax/record patterns; not definitive. ' +
      'Confirm via offering plan / corporation records.'
    );
    return {
      ownershipTypeLabel: 'Possible co-op (unconfirmed)',
      ownershipConfidence: 'medium',
      ownershipScore: score,
      ownershipEvidence: evidence,
      ownershipWarnings: warnings,
    };
  }

  // Default: Unknown / not specified
  return {
    ownershipTypeLabel: 'Unknown / not specified',
    ownershipConfidence: 'low',
    ownershipScore: score,
    ownershipEvidence: evidence.length > 0 ? evidence : ['No ownership indicators found in municipal data'],
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
