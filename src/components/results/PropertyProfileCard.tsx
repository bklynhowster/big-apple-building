import { Building2, Home, Calendar, Maximize2, Layers, Users, AlertCircle, HelpCircle, Info, Landmark } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePropertyProfile, PropertyTypeLabel, PropertyTenure } from '@/hooks/usePropertyProfile';
import { cn } from '@/lib/utils';
import type { LandmarkStatus } from '@/hooks/useLandmarkStatus';
import { LocationMap } from './LocationMap';
import { HistoricPhotographSection } from './HistoricPhotographSection';

interface PropertyProfileCardProps {
  bbl: string;
  unitLabel?: string | null;
  parentAddress?: string;
  landmarkStatus?: LandmarkStatus;
  lat?: number;
  lon?: number;
}

// Color mapping for property types - using ELK theme tokens
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

export function PropertyProfileCard({ bbl, unitLabel, parentAddress, landmarkStatus, lat, lon }: PropertyProfileCardProps) {
  const { loading, error, profile, retry } = usePropertyProfile(bbl);

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

  // BUILDING PAGE - Full display
  const hasData = profile.propertyTypeLabel !== 'Unknown' || 
                  profile.buildingClass || 
                  profile.residentialUnits !== null ||
                  profile.yearBuilt !== null;

  const isCoop = profile.propertyTenure === 'COOP';

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
          {/* Property Type Badge - Large */}
          <div className="flex items-center gap-4">
            <div className={cn(
              "flex items-center justify-center h-14 w-14 rounded-lg",
              PROPERTY_TYPE_COLORS[profile.propertyTypeLabel]
            )}>
              {PROPERTY_TYPE_ICONS[profile.propertyTypeLabel]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-lg font-semibold px-3 py-1 rounded-full",
                  PROPERTY_TYPE_COLORS[profile.propertyTypeLabel]
                )}>
                  {profile.propertyTypeLabel}
                </span>
              </div>
              {profile.buildingClass && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-sm text-muted-foreground cursor-help mt-1 block">
                        Building Class: <span className="font-mono font-medium">{profile.buildingClass}</span>
                        {profile.landUse && <span> • Land Use: {profile.landUse}</span>}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>NYC DOF building classification code</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
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
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-warning/15 text-warning px-2 py-0.5 text-sm font-semibold cursor-help">
                            <Building2 className="h-3.5 w-3.5" />
                            Yes
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          {landmarkStatus.isIndividual && landmarkStatus.individualName && (
                            <p className="mb-1">
                              <span className="font-medium">Individual Landmark:</span> {landmarkStatus.individualName}
                              {landmarkStatus.individualDate && (
                                <span className="text-muted-foreground"> (Designated {landmarkStatus.individualDate})</span>
                              )}
                            </p>
                          )}
                          {landmarkStatus.isHistoricDistrict && landmarkStatus.districtName && (
                            <p>
                              <span className="font-medium">Historic District:</span> {landmarkStatus.districtName}
                            </p>
                          )}
                          {!landmarkStatus.individualName && !landmarkStatus.districtName && (
                            <p>This property is landmarked</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {landmarkStatus.status === 'no' && !landmarkStatus.error && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-sm">
                      <Building2 className="h-3.5 w-3.5" />
                      No
                    </span>
                  )}
                  {landmarkStatus.status === 'unknown' && (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-muted bg-background text-muted-foreground px-2 py-0.5 text-sm">
                      <HelpCircle className="h-3.5 w-3.5" />
                      Unknown
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Historic Municipal Photograph Section */}
        <HistoricPhotographSection 
          block={profile.block} 
          lot={profile.lot} 
          borough={profile.borough}
          landUse={profile.landUse}
          bbl={bbl}
        />

        {/* Co-op disclaimer */}
        {isCoop && (
          <div className="elk-info-box flex items-start gap-2 mt-4">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <p>
              Co-op units do not have individual tax lots/BBLs. Most NYC regulatory records are issued at the building level.
            </p>
          </div>
        )}

        {/* Data source note */}
        {hasData && (
          <div className="mt-4 pt-3 border-t text-xs text-muted-foreground">
            Source: NYC PLUTO (Primary Land Use Tax Lot Output)
          </div>
        )}
      </CardContent>
    </Card>
  );
}
