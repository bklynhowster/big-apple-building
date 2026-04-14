import React, { useState, useEffect } from 'react';
import { Building2, Home, Calendar, Maximize2, Layers, Users, AlertCircle, HelpCircle, Info, Landmark, ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { usePropertyProfile, PropertyTypeLabel, OwnershipConfidenceLevel, InferredConfidenceLevel } from '@/hooks/usePropertyProfile';
import { useOwnershipOverride, OwnershipOverrideType } from '@/hooks/useOwnershipOverride';
import { cn } from '@/lib/utils';
import type { LandmarkStatus } from '@/hooks/useLandmarkStatus';
import { LocationMap } from './LocationMap';


interface PropertyProfileCardProps {
  bbl: string;
  unitLabel?: string | null;
  parentAddress?: string;
  landmarkStatus?: LandmarkStatus;
  lat?: number;
  lon?: number;
  onOwnershipOverrideChange?: (isCoopEffective: boolean) => void;
}

// Color mapping for property types
const PROPERTY_TYPE_COLORS: Record<PropertyTypeLabel, string> = {
  'Condo': 'bg-accent text-accent-foreground',
  'Co-op': 'bg-primary/10 text-primary',
  '1-2 Family': 'bg-success/10 text-success',
  '3+ Family': 'bg-success/15 text-success',
  'Mixed-Use': 'bg-warning/10 text-warning',
  'Commercial': 'bg-warning/15 text-warning-foreground',
  'Other': 'bg-muted text-muted-foreground',
  'Unknown': 'bg-muted text-muted-foreground',
};

// Icon for property type
const PROPERTY_TYPE_ICONS: Record<PropertyTypeLabel, React.ReactNode> = {
  'Condo': <Building2 className="h-5 w-5" />,
  'Co-op': <Building2 className="h-5 w-5" />,
  '1-2 Family': <Home className="h-5 w-5" />,
  '3+ Family': <Layers className="h-5 w-5" />,
  'Mixed-Use': <Layers className="h-5 w-5" />,
  'Commercial': <Building2 className="h-5 w-5" />,
  'Other': <Building2 className="h-5 w-5" />,
  'Unknown': <HelpCircle className="h-5 w-5" />,
};

// Styles for ownership confidence levels
function getConfidenceStyles(confidence: OwnershipConfidenceLevel): string {
  switch (confidence) {
    case 'Confirmed':
      return 'bg-accent text-accent-foreground';
    case 'Market-known':
      return 'bg-warning/10 text-warning border border-warning/30';
    case 'Unverified':
      return 'bg-muted text-muted-foreground';
  }
}

// Styles for inferred confidence levels
function getInferredConfidenceStyles(confidence: InferredConfidenceLevel): string {
  switch (confidence) {
    case 'High':
      return 'bg-accent/10 text-accent-foreground border border-accent/20';
    case 'Medium':
      return 'bg-warning/10 text-warning border border-warning/20';
    case 'Low':
      return 'bg-muted text-muted-foreground';
  }
}

// Format confidence label for display
function formatConfidenceLabel(confidence: OwnershipConfidenceLevel): string {
  if (confidence === 'Market-known') {
    return 'Market-known (unverified)';
  }
  return confidence;
}

function LoadingSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatNumber(num: number | null): string {
  if (num === null) return '—';
  return num.toLocaleString();
}

function formatSqFt(sqft: number | null): string {
  if (sqft === null) return '—';
  return `${sqft.toLocaleString()} sq ft`;
}

export function PropertyProfileCard({ bbl, unitLabel, parentAddress, landmarkStatus, lat, lon, onOwnershipOverrideChange }: PropertyProfileCardProps) {
  const { loading, error, profile, retry } = usePropertyProfile(bbl);
  const [showWhyPanel, setShowWhyPanel] = useState(false);
  
  // Compute inferred co-op status
  const isCoopInferred = profile?.ownership?.type === 'Cooperative' && 
    (profile?.ownership?.coopLikelihoodScore ?? 0) >= 8;
  
  // Manual override hook
  const { override, setOverride, isCoopEffective } = useOwnershipOverride(bbl, isCoopInferred);
  
  // Notify parent of effective co-op status changes
  useEffect(() => {
    if (onOwnershipOverrideChange && profile) {
      onOwnershipOverrideChange(isCoopEffective);
    }
  }, [isCoopEffective, onOwnershipOverrideChange, profile]);
  
  // Handle override selection
  const handleOverrideChange = (value: string) => {
    if (value === 'clear') {
      setOverride(null);
    } else if (value === 'coop') {
      setOverride('COOP');
    } else if (value === 'not_coop') {
      setOverride('NOT_COOP');
    }
  };

  // Determine if this is a unit page
  const lotNumber = parseInt(bbl.slice(6), 10);
  const isUnitLot = lotNumber >= 1001 && lotNumber <= 6999;

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">Unable to load property profile</span>
          </div>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!profile) {
    return null;
  }

  // UNIT PAGE - Simplified display
  if (isUnitLot) {
    const displayUnitLabel = unitLabel || (lotNumber - 1000).toString();
    
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Home className="h-4 w-4 text-muted-foreground" />
            Unit Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Unit Identity */}
            <div className="flex items-center gap-4">
              <div className={cn(
                "flex items-center justify-center h-14 w-14 rounded-lg",
                PROPERTY_TYPE_COLORS['Condo']
              )}>
                <Home className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-lg font-semibold px-3 py-1 rounded-full",
                    PROPERTY_TYPE_COLORS['Condo']
                  )}>
                    Unit {displayUnitLabel}
                  </span>
                </div>
                {parentAddress && (
                  <span className="text-sm text-muted-foreground mt-1 block">
                    <Building2 className="h-3.5 w-3.5 inline mr-1" />
                    {parentAddress}
                  </span>
                )}
              </div>
            </div>

            {/* Unit Details - Limited */}
            <div className="grid grid-cols-2 gap-4 pt-2">
              {/* Unit BBL */}
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Unit BBL</div>
                <div className="font-mono font-medium">{bbl}</div>
              </div>
              
              {/* Property Type */}
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Property Type</div>
                <div className="font-medium">Condominium Unit</div>
              </div>
            </div>

            {/* Note about structural attributes */}
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Unit-level structural attributes (year built, floors, area) are not applicable. 
                These are properties of the building, not individual units.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // BUILDING PAGE - Full display with two-layer ownership
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          Property Profile
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Embedded Location Map */}
        {lat && lon && (
          <LocationMap lat={lat} lon={lon} address={parentAddress} />
        )}
        
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Two-Section Ownership Display */}
          <div className="flex flex-col gap-4 min-w-[300px]">
            {/* SECTION A: NYC Municipal Ownership */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                NYC Municipal Ownership
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="inline-flex items-center gap-1.5 cursor-help">
                      <span className={cn(
                        "text-sm font-medium px-3 py-1.5 rounded-md",
                        profile.municipal.label === 'Condominium' 
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-muted text-muted-foreground'
                      )}>
                        {profile.municipal.label}
                      </span>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-sm">
                    <div className="space-y-2">
                      <p className="text-xs font-medium">
                        This reflects only what NYC municipal datasets explicitly state.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Co-op ownership is often not explicitly labeled in municipal data.
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Source: {profile.municipal.source}
                      </p>
                      {profile.municipal.evidence.length > 0 && (
                        <div className="mt-2">
                          <p className="font-medium text-xs mb-1">Data available:</p>
                          <ul className="text-xs space-y-0.5">
                            {profile.municipal.evidence.map((item, i) => (
                              <li key={i} className="flex items-start gap-1">
                                <span className="text-muted-foreground">•</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {profile.municipal.label === 'Condominium' && (
                <p className="text-xs text-muted-foreground italic">
                  Individual units are separately owned. Building-level owner reflects the condo association or managing entity on file with NYC.
                </p>
              )}
            </div>

            {/* SECTION B: Ownership Structure (Inferred/Manual) */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                Ownership Structure {override ? '(manual)' : '(inferred)'}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Manual override badge - takes priority */}
                  {override && (
                    <Badge 
                      variant="outline" 
                      className="text-xs bg-primary/10 text-primary border-primary/30"
                    >
                      {override === 'COOP' ? 'Manual override: Co-op' : 'Manual override: Not a co-op'}
                    </Badge>
                  )}
                  
                  {/* Inferred ownership badge - shown when no override */}
                  {!override && (
                    <>
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs",
                          getConfidenceStyles(profile.ownership.confidence)
                        )}
                      >
                        {profile.ownership.confidence === 'Unverified' 
                          ? 'Unverified' 
                          : profile.ownership.type === 'Cooperative'
                            ? 'Co-op (inferred)'
                            : `${formatConfidenceLabel(profile.ownership.confidence)}: ${profile.ownership.type}`}
                      </Badge>
                      
                      {/* Confidence badge for inferred co-op */}
                      {profile.ownership.type === 'Cooperative' && profile.ownership.coopLikelihoodScore >= 8 && (
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-xs",
                            getInferredConfidenceStyles(profile.ownership.inferredConfidence)
                          )}
                        >
                          {profile.ownership.inferredConfidence} confidence
                        </Badge>
                      )}
                    </>
                  )}
                </div>

                {/* Manual override control */}
                <div className="flex items-center gap-2 pt-1">
                  <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <Select
                    value={override === 'COOP' ? 'coop' : override === 'NOT_COOP' ? 'not_coop' : 'none'}
                    onValueChange={handleOverrideChange}
                  >
                    <SelectTrigger className="h-7 w-[180px] text-xs">
                      <SelectValue placeholder="Manual override..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">No override (use inferred)</SelectItem>
                      <SelectItem value="coop" className="text-xs">Override: Co-op</SelectItem>
                      <SelectItem value="not_coop" className="text-xs">Override: Not a co-op</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {/* Clear override with confirmation */}
                  {override && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                          Clear
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Clear manual override?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove your manual ownership designation and revert to the inferred classification based on structural indicators.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => setOverride(null)}>
                            Clear override
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
                
                {/* Override disclaimer */}
                <p className="text-xs text-muted-foreground italic">
                  Overrides only affect ELK display logic for unit-mentions and coop labeling. Not an official classification.
                </p>

                {/* "Why" expandable disclosure - show inference details even if override active */}
                <Collapsible open={showWhyPanel} onOpenChange={setShowWhyPanel}>
                  <CollapsibleTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {showWhyPanel ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5 mr-1" />
                          Hide inference details
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5 mr-1" />
                          {override ? 'Inference (ignored)' : 'Why?'}
                        </>
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <div className={cn(
                      "p-3 rounded-md space-y-3 text-sm",
                      override ? "bg-muted/30 opacity-60" : "bg-muted/50"
                    )}>
                      {override && (
                        <p className="text-xs font-medium text-muted-foreground italic">
                          These inference details are currently ignored due to your manual override.
                        </p>
                      )}
                      
                      {/* Score display */}
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Co-op likelihood score:</span>
                        <Badge variant="outline" className="font-mono">
                          {profile.ownership.coopLikelihoodScore}/10
                        </Badge>
                      </div>
                      
                      {/* Indicators list */}
                      {profile.ownership.indicators.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Structural indicators:</p>
                          <ul className="text-xs space-y-1">
                            {profile.ownership.indicators.map((indicator, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <span className="text-muted-foreground mt-0.5">•</span>
                                <span>{indicator}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {/* Score thresholds explanation */}
                      <div className="text-xs text-muted-foreground border-t border-border pt-2">
                        <p>Score ≥8 = Co-op (inferred)</p>
                        <p>Score ≥9 = High confidence, Score 8 = Medium confidence</p>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {/* Inference disclaimer - only show when not overridden */}
                {!override && (
                  <p className="text-xs text-muted-foreground">
                    {profile.ownership.type === 'Cooperative' && profile.ownership.coopLikelihoodScore >= 8
                      ? 'Inferred from structural indicators (unit count, tax lot structure, and record text). Not legal confirmation. Verify via ACRIS / offering plan / corporate filings.'
                      : profile.ownership.disclaimerKey === 'market-known' 
                        ? 'Based on structural indicators (unit count, tax lot structure, and record text). Not a legal confirmation. Confirm via ACRIS / offering plan / corporate filings.'
                        : 'Municipal datasets do not reliably indicate cooperative ownership. Confirm via external records.'}
                  </p>
                )}
              </div>
            </div>

            {/* Building class for reference */}
            {profile.buildingClass && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground cursor-help block">
                      Building Class: <span className="font-mono font-medium">{profile.buildingClass}</span>
                      {profile.landUse && <span> • Land Use: {profile.landUse}</span>}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>NYC DOF building classification code (not used for ownership inference)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Property Details Grid */}
          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Residential Units */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>Units</span>
              </div>
              <div className="font-medium">
                {profile.residentialUnits !== null ? (
                  <>
                    {formatNumber(profile.residentialUnits)} residential
                    {profile.totalUnits !== null && profile.totalUnits !== profile.residentialUnits && (
                      <span className="text-muted-foreground text-sm"> / {formatNumber(profile.totalUnits)} total</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>

            {/* Year Built */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>Year Built</span>
              </div>
              <div className="font-medium">
                {profile.yearBuilt ? profile.yearBuilt : <span className="text-muted-foreground">—</span>}
              </div>
            </div>

            {/* Building Area */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Maximize2 className="h-3.5 w-3.5" />
                <span>Building Area</span>
              </div>
              <div className="font-medium">
                {profile.grossSqFt ? formatSqFt(profile.grossSqFt) : <span className="text-muted-foreground">—</span>}
              </div>
            </div>

            {/* Floors */}
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                <span>Floors</span>
              </div>
              <div className="font-medium">
                {profile.numFloors ? formatNumber(profile.numFloors) : <span className="text-muted-foreground">—</span>}
              </div>
            </div>

            {/* Landmark Status */}
            {landmarkStatus && !landmarkStatus.isLoading && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Landmark className="h-3.5 w-3.5" />
                  <span>Landmark</span>
                </div>
                <div className="font-medium">
                  {landmarkStatus.status === 'yes' && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/15 text-warning px-2 py-0.5 text-sm font-semibold">
                      <Building2 className="h-3.5 w-3.5" />
                      Yes
                    </span>
                  )}
                  {landmarkStatus.status === 'no' && (
                    <span className="text-muted-foreground">No</span>
                  )}
                  {landmarkStatus.status === 'unknown' && (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
