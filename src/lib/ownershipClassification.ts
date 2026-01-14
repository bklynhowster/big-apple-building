/**
 * Two-Layer Ownership Classification with Scored Structural Evidence
 * 
 * SECTION A: Municipal Ownership (NYC data)
 * - ONLY reflects explicit NYC municipal dataset indicators
 * - NO building class inference, NO CO strings, NO heuristics
 * - Output: "Condominium" (only if explicit condoNo or condo unit BBLs) or "Ownership type not specified in municipal data"
 * 
 * SECTION B: Ownership Structure (Inferred)
 * - Uses structural evidence scoring (0-10) to determine co-op likelihood
 * - Output: "Unverified" (default) or "Market-known (unverified)" (when threshold met)
 * - "Confirmed" is NOT used until we have explicit external confirmation sources
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

// ============ SECTION B: Ownership Structure (Inferred) ============

// Note: "Confirmed" is reserved for explicit external sources (not yet implemented)
export type OwnershipConfidenceLevel = 'Confirmed' | 'Market-known' | 'Unverified';
export type InferredConfidenceLevel = 'Low' | 'Medium' | 'High';

export type OwnershipStructureType = 
  | 'Condominium'
  | 'Cooperative'
  | 'Unknown';

export interface OwnershipStructure {
  type: OwnershipStructureType;
  confidence: OwnershipConfidenceLevel;
  inferredConfidence: InferredConfidenceLevel;
  coopLikelihoodScore: number;
  indicators: string[];
  sources: string[];
  disclaimerKey: 'unverified' | 'market-known';
}

// ============ Combined Profile ============

export interface OwnershipProfile {
  municipal: MunicipalClassification;
  ownership: OwnershipStructure;
  warnings: string[];
}

export interface ScoringInputs {
  unitsResidential: number | null;
  condoUnitsCount: number;
  hasCondoFlag: boolean;
  unitBblCount: number | null;
  mentionedUnitCount: number;
  salesRecordsCount: number;
  unitSalesCount: number;
  buildingClass: string | null;
}

// Building classes that have low positive weight for co-op likelihood
const COOP_INDICATOR_CLASSES = ['D4', 'D6', 'D7', 'D8'];

/**
 * SECTION A: Municipal Classification
 * 
 * STRICT RULES:
 * - Do NOT use building class codes (e.g., C0, D4, R0-R9) to infer ownership
 * - Do NOT use "CO" strings or certificate-of-occupancy references
 * - Do NOT use unit count, BBL patterns, or anything heuristic
 * - Only show "Condominium" if:
 *   1. condoNo field is explicitly set, OR
 *   2. condo unit BBL splits exist (condoUnitsCount > 0)
 */
export function computeMunicipalClassification(
  condoNo: string | number | null,
  condoUnitsCount: number,
  buildingClass: string | null,
  landUse: string | null,
  residentialUnits: number | null
): MunicipalClassification {
  const bc = (buildingClass || '').toUpperCase().trim();
  const evidence: string[] = [];

  // Check for explicit condo indicators
  const hasExplicitCondoNo = condoNo !== null && condoNo !== undefined && 
    String(condoNo).trim() !== '' && String(condoNo) !== '0';

  // If condo unit BBLs exist, this is a condominium
  if (condoUnitsCount > 0) {
    evidence.push(`Condo unit BBLs detected: ${condoUnitsCount} unit(s)`);
    if (hasExplicitCondoNo) {
      evidence.push(`Condo Number: ${condoNo}`);
    }
    
    return {
      label: 'Condominium',
      evidence,
      source: 'NYC DOF (Department of Finance)',
    };
  }

  // If explicit condoNo exists, this is a condominium
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
  if (landUse) evidence.push(`Land Use: ${landUse}`);
  if (residentialUnits) evidence.push(`Residential Units: ${residentialUnits}`);

  return {
    label: 'Ownership type not specified in municipal data',
    evidence: evidence.length > 0 ? evidence : ['No explicit ownership indicators in municipal data'],
    source: 'NYC PLUTO/DOB',
  };
}

/**
 * SECTION B: Ownership Structure Scoring
 * 
 * Computes a co-op likelihood score (0-10) based on structural evidence.
 * 
 * STRICT RULES:
 * - If condoUnitsCount > 0 OR hasCondoFlag === true: score = 0, type = Condominium
 * - Otherwise, apply scoring signals from structural indicators
 * - Do NOT infer from DOB, PLUTO, CO status, building class (except low weight for D4/D6/D7/D8)
 */
export function computeOwnershipStructure(
  municipal: MunicipalClassification,
  inputs: ScoringInputs
): OwnershipStructure {
  const indicators: string[] = [];
  let score = 0;

  // HARD BLOCK: If condo indicators exist, this is a condominium
  if (inputs.condoUnitsCount > 0 || inputs.hasCondoFlag) {
    if (inputs.condoUnitsCount > 0) {
      indicators.push(`Condo unit BBLs detected (${inputs.condoUnitsCount} units)`);
    }
    if (inputs.hasCondoFlag) {
      indicators.push('Municipal condo flag detected');
    }
    
    return {
      type: 'Condominium',
      confidence: 'Confirmed',
      inferredConfidence: 'High',
      coopLikelihoodScore: 0,
      indicators,
      sources: ['NYC DOF'],
      disclaimerKey: 'unverified',
    };
  }

  // Apply scoring signals
  const unitsRes = inputs.unitsResidential ?? 0;
  const unitBblCount = inputs.unitBblCount ?? 0;
  const mentionedUnitCount = inputs.mentionedUnitCount;
  const bc = (inputs.buildingClass || '').toUpperCase().trim();

  // Signal 1: Large building on single tax lot (no unit BBL splits)
  if (unitsRes >= 10 && (unitBblCount === 0 || inputs.unitBblCount === null)) {
    score += 4;
    indicators.push(`${unitsRes} residential units on a single tax lot`);
  }

  // Signal 2: Multi-unit building with no condo indicators
  if (unitsRes >= 2 && inputs.condoUnitsCount === 0 && !inputs.hasCondoFlag) {
    score += 3;
    indicators.push('No condo unit BBL splits detected');
  }

  // Signal 3: High unit mention count in records
  if (mentionedUnitCount >= 20) {
    score += 3;
    indicators.push(`${mentionedUnitCount} records reference apartment/unit numbers`);
  } else if (mentionedUnitCount >= 5) {
    score += 2;
    indicators.push(`${mentionedUnitCount} records reference apartment/unit numbers`);
  }

  // Signal 4: Building sales without unit sales (may indicate co-op)
  if (inputs.salesRecordsCount > 0 && inputs.unitSalesCount === 0) {
    score += 2;
    indicators.push('Building-level sales without unit sales records');
  }

  // Signal 5: Building class (very low weight)
  if (COOP_INDICATOR_CLASSES.some(c => bc.startsWith(c))) {
    score += 1;
    indicators.push(`Building class ${bc} is common for co-ops`);
  }

  // CAP: If small building (<=2 units), never reach market-known
  if (unitsRes <= 2) {
    score = Math.min(score, 2);
    if (score < 7) {
      indicators.push('Small building (≤2 units) - capped score');
    }
  }

  // Determine confidence and structure based on score
  if (score >= 7) {
    return {
      type: 'Cooperative',
      confidence: 'Market-known',
      inferredConfidence: score >= 9 ? 'High' : 'Medium',
      coopLikelihoodScore: Math.min(score, 10),
      indicators,
      sources: ['Structural analysis'],
      disclaimerKey: 'market-known',
    };
  }

  // Default: Unverified
  return {
    type: 'Unknown',
    confidence: 'Unverified',
    inferredConfidence: 'Low',
    coopLikelihoodScore: Math.min(score, 10),
    indicators: indicators.length > 0 ? indicators : ['Insufficient structural evidence'],
    sources: [],
    disclaimerKey: 'unverified',
  };
}

/**
 * Computes complete two-layer ownership profile.
 */
export function computeOwnershipProfile(
  condoNo: string | number | null,
  buildingClass: string | null,
  landUse: string | null,
  residentialUnits: number | null,
  scoringInputs: ScoringInputs
): OwnershipProfile {
  const municipal = computeMunicipalClassification(
    condoNo,
    scoringInputs.condoUnitsCount,
    buildingClass,
    landUse,
    residentialUnits
  );
  
  const ownership = computeOwnershipStructure(municipal, scoringInputs);

  const warnings: string[] = [];

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

export function getInferredConfidenceStyles(confidence: InferredConfidenceLevel): string {
  switch (confidence) {
    case 'High':
      return 'bg-accent/10 text-accent-foreground border border-accent/20';
    case 'Medium':
      return 'bg-warning/10 text-warning border border-warning/20';
    case 'Low':
      return 'bg-muted text-muted-foreground';
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
