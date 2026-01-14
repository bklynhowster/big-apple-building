/**
 * Two-Layer Ownership Classification
 * 
 * LAYER 1: Municipal Classification
 * - Only reflects what NYC municipal datasets explicitly state
 * - Never infers cooperative from DOB, PLUTO, CO status, or building class
 * 
 * LAYER 2: Ownership Structure (Non-Municipal)
 * - Uses external ownership indicators (ACRIS, offering plans, sales records)
 * - Labels as "Confirmed", "Likely", or "Unverified"
 */

// ============ LAYER 1: Municipal Classification ============

export type MunicipalOwnershipLabel = 
  | 'Condominium'
  | 'Ownership type not specified in municipal data';

export interface MunicipalClassification {
  label: MunicipalOwnershipLabel;
  evidence: string[];
  source: string; // e.g., "NYC PLUTO", "DOB"
}

// ============ LAYER 2: Ownership Structure ============

export type OwnershipConfidenceLevel = 'Confirmed' | 'Likely' | 'Unverified';

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
  sources: string[]; // e.g., ["ACRIS", "Offering Plan", "Sales Records"]
}

// ============ Combined Profile ============

export interface OwnershipProfile {
  // Layer 1: What municipal data explicitly says
  municipal: MunicipalClassification;
  
  // Layer 2: Ownership structure from all sources
  ownership: OwnershipStructure;
  
  // Warnings/notes
  warnings: string[];
}

// Condo building classes: R0-R9, RR, RS
const CONDO_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'RR', 'RS'];

export interface PropertyData {
  buildingClass?: string | null;
  landUse?: string | null;
  condoNo?: string | number | null;
  residentialUnits?: number | null;
  totalUnits?: number | null;
  hasMultipleUnitBBLs?: boolean;
  unitBBLCount?: number;
  // External ownership indicators (Layer 2)
  acrisCoopIndicator?: boolean;
  acrisCoopSource?: string;
  offeringPlanType?: 'cooperative' | 'condominium' | null;
  salesRecordType?: 'cooperative' | 'condominium' | null;
}

/**
 * Computes Layer 1: Municipal Classification
 * Only uses explicit municipal data indicators.
 */
function computeMunicipalClassification(data: PropertyData): MunicipalClassification {
  const bc = (data.buildingClass || '').toUpperCase().trim();
  const condoNo = data.condoNo;
  const hasMultipleUnitBBLs = data.hasMultipleUnitBBLs || false;
  const unitBBLCount = data.unitBBLCount || 0;

  const evidence: string[] = [];

  // Check for explicit condo indicators
  const isCondoClass = CONDO_CLASSES.some(c => bc.startsWith(c));
  const hasCondoNo = condoNo !== null && condoNo !== undefined && 
    String(condoNo).trim() !== '' && String(condoNo) !== '0';

  // Condo via unit BBLs
  if (hasMultipleUnitBBLs && unitBBLCount > 0) {
    evidence.push(`Multiple unit BBLs present (${unitBBLCount} units)`);
    if (isCondoClass) evidence.push(`Building Class: ${bc} (condo class)`);
    if (hasCondoNo) evidence.push(`Condo Number: ${condoNo}`);
    
    return {
      label: 'Condominium',
      evidence,
      source: 'NYC DOF/PLUTO',
    };
  }

  // Condo via class or condo number
  if (isCondoClass || hasCondoNo) {
    if (isCondoClass) evidence.push(`Building Class: ${bc} (condo class)`);
    if (hasCondoNo) evidence.push(`Condo Number: ${condoNo}`);
    
    return {
      label: 'Condominium',
      evidence,
      source: 'NYC PLUTO',
    };
  }

  // Default: not specified
  if (bc) evidence.push(`Building Class: ${bc}`);
  if (data.landUse) evidence.push(`Land Use: ${data.landUse}`);
  if (data.residentialUnits) evidence.push(`Residential Units: ${data.residentialUnits}`);

  return {
    label: 'Ownership type not specified in municipal data',
    evidence: evidence.length > 0 ? evidence : ['No explicit ownership indicators'],
    source: 'NYC PLUTO/DOB',
  };
}

/**
 * Computes Layer 2: Ownership Structure
 * Uses external indicators when available.
 */
function computeOwnershipStructure(
  data: PropertyData, 
  municipal: MunicipalClassification
): OwnershipStructure {
  const sources: string[] = [];
  const evidence: string[] = [];

  // If municipal says Condominium, that's confirmed
  if (municipal.label === 'Condominium') {
    return {
      type: 'Condominium',
      confidence: 'Confirmed',
      evidence: municipal.evidence,
      sources: [municipal.source],
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

  if (data.salesRecordType === 'cooperative') {
    sources.push('Sales Records');
    evidence.push('Property sold as cooperative unit');
    
    return {
      type: 'Cooperative',
      confidence: 'Likely',
      evidence,
      sources,
    };
  }

  // No external indicators available
  return {
    type: 'Unknown',
    confidence: 'Unverified',
    evidence: ['No external ownership records available'],
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

  // Always add warning about DOB/PLUTO limitations when ownership is unknown
  if (ownership.type === 'Unknown') {
    warnings.push(
      'DOB and PLUTO data do not reliably indicate cooperative ownership. ' +
      'Ownership structure requires verification via ACRIS, offering plan, or corporation filings.'
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
    case 'Likely':
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
