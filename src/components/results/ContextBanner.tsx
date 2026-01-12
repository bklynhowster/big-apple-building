import { ArrowLeft, Building2, Home, ChevronRight } from 'lucide-react';
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

export type QueryScope = 'unit' | 'building';

interface ContextBannerProps {
  address?: string;
  unitLabel?: string | null;
  unitBbl: string;
  billingBbl?: string | null;
  bin?: string;
  borough?: string;
  isCondoUnit: boolean;
  scope: QueryScope;
  onScopeChange: (scope: QueryScope) => void;
}

export function ContextBanner({
  address,
  unitLabel,
  unitBbl,
  billingBbl,
  bin,
  borough,
  isCondoUnit,
  scope,
  onScopeChange,
}: ContextBannerProps) {
  const navigate = useNavigate();
  
  // Build the building URL for "back to building" navigation
  const buildingUrl = billingBbl 
    ? `/results?bbl=${billingBbl}&borough=${encodeURIComponent(borough || '')}&address=${encodeURIComponent(address || '')}`
    : null;

  if (!isCondoUnit) {
    // Non-condo / Building view - simpler banner
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

  // Condo unit view - prominent banner with unit context
  return (
    <div className="bg-primary/5 border-2 border-primary/20 rounded-lg overflow-hidden">
      {/* Breadcrumb Navigation */}
      <div className="bg-background/50 px-4 py-2 border-b border-primary/10">
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
                    {address || 'Building'}
                  </Link>
                </BreadcrumbLink>
              ) : (
                <span className="text-muted-foreground">{address || 'Building'}</span>
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
            <div className="flex items-center justify-center w-12 h-12 bg-primary/20 rounded-lg shrink-0">
              <Home className="h-6 w-6 text-primary" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">
                  Condominium Unit: {unitLabel || 'Unknown'}
                </h1>
                <Badge variant="default" className="uppercase text-[10px]">Unit View</Badge>
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                Located in: {address || 'Building'} (Building)
              </p>
              
              {/* Identifiers - hierarchical */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="flex items-center gap-1.5">
                  <Badge variant="default" className="font-mono text-xs">
                    Unit BBL: {unitBbl}
                  </Badge>
                </div>
                {billingBbl && (
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

          {/* Back to Building Button */}
          {buildingUrl && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              onClick={() => navigate(buildingUrl)}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to building overview
            </Button>
          )}
        </div>

        {/* Global Scope Toggle */}
        <div className="mt-4 pt-4 border-t border-primary/10">
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
  );
}
