import { ArrowLeft, Building2, Home, ChevronRight, Info } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { ContextIndicator } from './ContextIndicator';
import { CoopUnitContext } from './CoopUnitContext';
import { BuildingSummaryStrip } from './BuildingSummaryStrip';

export type QueryScope = 'unit' | 'building';

export interface BuildingProfileSummary {
  yearBuilt?: number | null;
  buildingClass?: string | null;
  totalUnits?: number | null;
  residentialUnits?: number | null;
  numFloors?: number | null;
  grossSqFt?: number | null;
  propertyTypeLabel?: string | null;
}

interface ContextBannerProps {
  address?: string;
  unitLabel?: string | null;
  unitBbl: string;
  billingBbl?: string | null;
  effectiveBbl?: string; // The actual BBL used for data queries
  bin?: string;
  borough?: string;
  buildingAddress?: string;
  buildingProfile?: BuildingProfileSummary | null;
  buildingProfileLoading?: boolean;
  isCondoUnit: boolean;
  isCoop?: boolean;
  coopUnitContext?: string | null;
  onCoopUnitContextChange?: (unit: string | null) => void;
  scope: QueryScope;
  onScopeChange: (scope: QueryScope) => void;
}

export function ContextBanner({
  address,
  unitLabel,
  unitBbl,
  billingBbl,
  effectiveBbl,
  bin,
  borough,
  buildingAddress,
  buildingProfile,
  buildingProfileLoading,
  isCondoUnit,
  isCoop = false,
  coopUnitContext,
  onCoopUnitContextChange,
  scope,
  onScopeChange,
}: ContextBannerProps) {
  const navigate = useNavigate();
  
  // Determine the best building address to display
  // Priority: buildingAddress (from URL when navigating to unit) > address (search param)
  const effectiveBuildingAddress = buildingAddress || address;
  
  // Build the building URL for "back to building" navigation
  const buildingUrl = billingBbl 
    ? `/results?bbl=${billingBbl}&borough=${encodeURIComponent(borough || '')}&address=${encodeURIComponent(effectiveBuildingAddress || '')}`
    : null;

  // CO-OP BUILDING VIEW - Different banner with unit context selector
  if (isCoop && !isCondoUnit) {
    return (
      <div className="space-y-3">
        {/* Co-op Context Indicator Pills */}
        {coopUnitContext && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-primary text-primary-foreground gap-1.5 py-1.5 px-3 text-sm">
              <Home className="h-4 w-4" />
              Viewing: {coopUnitContext}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="gap-1.5 py-1.5 px-3 text-sm cursor-help">
                  <Info className="h-3.5 w-3.5" />
                  Context only
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>NYC co-op units do not have individual tax lots or BBLs. All regulatory records apply to the building.</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Main Banner */}
        <div className="elk-highlight-banner overflow-hidden">
          {/* Breadcrumb Navigation */}
          <div className="bg-background/50 px-4 py-2 border-b border-border">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/" className="text-muted-foreground hover:text-foreground">Search</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator>
                  <ChevronRight className="h-4 w-4" />
                </BreadcrumbSeparator>
                <BreadcrumbItem>
                  <BreadcrumbPage>{address || `BBL ${unitBbl}`}</BreadcrumbPage>
                </BreadcrumbItem>
                {coopUnitContext && (
                  <>
                    <BreadcrumbSeparator>
                      <ChevronRight className="h-4 w-4" />
                    </BreadcrumbSeparator>
                    <BreadcrumbItem>
                      <BreadcrumbPage className="font-semibold">{coopUnitContext}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          {/* Main Banner Content */}
          <div className="p-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              {/* Building / Unit Identity */}
              <div className="flex items-start gap-4">
                <div className="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg shrink-0">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-1">
                  {coopUnitContext ? (
                    <>
                      <h1 className="text-xl font-bold text-foreground">
                        Co-op Apartment: {coopUnitContext}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">(Context Only)</span>
                      </h1>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        Located in: {address || 'Building'} (Building)
                      </p>
                    </>
                  ) : (
                    <>
                      <h1 className="text-xl font-bold text-foreground">
                        {address || 'Co-op Building'}
                      </h1>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-primary/10 text-primary">
                          Co-op
                        </Badge>
                      </div>
                    </>
                  )}
                  
                  {/* Identifiers */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                      BBL: {unitBbl}
                    </Badge>
                    {bin && (
                      <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                        BIN: {bin}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Co-op Unit Context Selector */}
              {onCoopUnitContextChange && (
                <div className="shrink-0">
                  <CoopUnitContext
                    selectedUnit={coopUnitContext || null}
                    onUnitChange={onCoopUnitContextChange}
                    buildingBbl={unitBbl}
                  />
                </div>
              )}
            </div>

            {/* Info about co-op data */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  <strong className="text-foreground">Co-op buildings:</strong> Unit-level regulatory records are not issued for NYC co-ops. 
                  All data shown is at the building level. You can optionally set a unit context for navigation purposes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // NON-CONDO / BUILDING VIEW - simpler banner
  if (!isCondoUnit) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <Breadcrumb className="mb-3">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/">Search</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>{address || `BBL ${unitBbl}`}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 bg-muted rounded-lg shrink-0">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {address || 'Property Details'}
            </h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">BBL: {unitBbl}</span>
              {bin && <span className="font-mono">• BIN: {bin}</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // CONDO UNIT VIEW - prominent banner with unit context and building info
  // Format full building address using effective address (buildingAddress param takes priority)
  const fullBuildingAddress = effectiveBuildingAddress 
    ? borough 
      ? `${effectiveBuildingAddress} — ${borough.toUpperCase()}`
      : effectiveBuildingAddress
    : null;

  return (
    <div className="space-y-3">
      {/* Building Context Banner - Prominent display of parent building */}
      <div className="bg-muted/50 border border-border rounded-lg px-4 py-3">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-start gap-3 flex-1">
            <div className="flex items-center justify-center w-9 h-9 bg-background border border-border rounded-lg shrink-0 mt-0.5">
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Building Context</p>
              <p className="text-sm font-semibold text-foreground">
                {fullBuildingAddress || 'Building Address Unavailable'}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {billingBbl && (
                  <span className="text-xs text-muted-foreground font-mono">
                    BBL: {billingBbl}
                  </span>
                )}
                {bin && (
                  <span className="text-xs text-muted-foreground font-mono">
                    • BIN: {bin}
                  </span>
                )}
              </div>
              
              {/* Building Summary Stats */}
              <BuildingSummaryStrip
                yearBuilt={buildingProfile?.yearBuilt}
                buildingClass={buildingProfile?.buildingClass}
                totalUnits={buildingProfile?.totalUnits}
                residentialUnits={buildingProfile?.residentialUnits}
                numFloors={buildingProfile?.numFloors}
                grossSqFt={buildingProfile?.grossSqFt}
                propertyTypeLabel={buildingProfile?.propertyTypeLabel}
                loading={buildingProfileLoading}
              />
            </div>
          </div>
          
          {/* Back to Building Button - with address */}
          {buildingUrl && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 shrink-0 text-xs"
              onClick={() => navigate(buildingUrl)}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {effectiveBuildingAddress ? `Back to building: ${effectiveBuildingAddress}` : 'Back to building overview'}
            </Button>
          )}
        </div>
      </div>

      {/* Pill-style Context Indicator - Impossible to miss */}
      <ContextIndicator 
        unitLabel={unitLabel} 
        isUnitView={scope === 'unit'}
      />

      {/* Main Banner */}
      <div className="elk-highlight-banner overflow-hidden">
        {/* Breadcrumb Navigation */}
        <div className="bg-background/50 px-4 py-2 border-b border-border">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/" className="text-muted-foreground hover:text-foreground">Search</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator>
                <ChevronRight className="h-4 w-4" />
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                {buildingUrl ? (
                  <BreadcrumbLink asChild>
                    <Link to={buildingUrl} className="text-muted-foreground hover:text-foreground">
                      {effectiveBuildingAddress || 'Building'}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <span className="text-muted-foreground">{effectiveBuildingAddress || 'Building'}</span>
                )}
              </BreadcrumbItem>
              <BreadcrumbSeparator>
                <ChevronRight className="h-4 w-4" />
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbPage className="font-semibold">
                  Unit {unitLabel || 'Details'}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        {/* Main Banner Content */}
        <div className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Unit Identity - Primary */}
            <div className="flex items-start gap-4">
              <div className="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg shrink-0">
                <Home className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-foreground">
                    Condominium Unit: {unitLabel || 'Unknown'}
                  </h1>
                </div>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  Located in: {fullBuildingAddress || 'Building'}
                </p>
                
                {/* Identifiers - hierarchical */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                      Viewing Unit BBL: {unitBbl}
                    </Badge>
                  </div>
                  {effectiveBbl && effectiveBbl !== unitBbl && (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="default" className="font-mono text-xs bg-amber-600 hover:bg-amber-700">
                        Records from Building BBL: {effectiveBbl}
                      </Badge>
                    </div>
                  )}
                  {billingBbl && billingBbl !== effectiveBbl && (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                        Building BBL: {billingBbl}
                      </Badge>
                    </div>
                  )}
                  {bin && (
                    <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                      BIN: {bin}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Global Scope Toggle */}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="text-sm font-medium text-foreground">Viewing data for:</span>
              <ToggleGroup 
                type="single" 
                value={scope} 
                onValueChange={(v) => v && onScopeChange(v as QueryScope)}
                className="justify-start"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem 
                      value="unit" 
                      aria-label="Unit scope" 
                      className="gap-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground px-4"
                    >
                      <Home className="h-4 w-4" />
                      Unit
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>View data for this specific unit</p>
                    <p className="font-mono text-xs mt-1">BBL: {unitBbl}</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem 
                      value="building" 
                      aria-label="Building scope" 
                      className="gap-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground px-4"
                    >
                      <Building2 className="h-4 w-4" />
                      Building
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>View data for the entire building</p>
                    {billingBbl && <p className="font-mono text-xs mt-1">BBL: {billingBbl}</p>}
                  </TooltipContent>
                </Tooltip>
              </ToggleGroup>
              
              <span className="text-xs text-muted-foreground sm:ml-2">
                This affects all tabs below
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
