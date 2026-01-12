import { Building2, Home, Calendar, Maximize2, Layers, Users, MapPin, AlertCircle, Loader2, HelpCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { usePropertyProfile, PropertyTypeLabel } from '@/hooks/usePropertyProfile';
import { cn } from '@/lib/utils';

interface PropertyProfileCardProps {
  bbl: string;
}

// Color mapping for property types
const PROPERTY_TYPE_COLORS: Record<PropertyTypeLabel, string> = {
  'Condo': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  'Co-op': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  '1-2 Family': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  '3+ Family': 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  'Mixed-Use': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  'Commercial': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  'Other': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
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

export function PropertyProfileCard({ bbl }: PropertyProfileCardProps) {
  const { loading, error, profile, retry } = usePropertyProfile(bbl);

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

  const hasData = profile.propertyTypeLabel !== 'Unknown' || 
                  profile.buildingClass || 
                  profile.residentialUnits !== null ||
                  profile.yearBuilt !== null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          Property Profile
        </CardTitle>
      </CardHeader>
      <CardContent>
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
          </div>
        </div>

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
