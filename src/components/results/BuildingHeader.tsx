import { Building2, ChevronRight, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

interface BuildingHeaderProps {
  address: string;
  borough?: string;
  bbl: string;
  bin?: string;
  propertyType?: string | null;
  totalUnits?: number | null;
  loading?: boolean;
}

export function BuildingHeader({
  address,
  borough,
  bbl,
  bin,
  propertyType,
  totalUnits,
  loading = false,
}: BuildingHeaderProps) {
  // Format display address with borough
  const displayAddress = borough 
    ? `${address} — ${borough}`
    : address;

  // Format subtitle line: Property type • Units
  const subtitleParts: string[] = [];
  if (propertyType) {
    subtitleParts.push(propertyType);
  }
  if (totalUnits && totalUnits > 0) {
    subtitleParts.push(`${totalUnits} registered units`);
  }
  const subtitle = subtitleParts.join(' • ');

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Breadcrumb Navigation */}
      <div className="bg-muted/30 px-4 py-2 border-b border-border">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/" className="text-muted-foreground hover:text-foreground">
                  Search
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="h-4 w-4" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage>{address || `BBL ${bbl}`}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Main Header Content */}
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          {/* Left: Address and property type */}
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center w-11 h-11 bg-primary/10 rounded-lg shrink-0">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1">
              {/* Primary: Address with borough */}
              <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">
                {displayAddress}
              </h1>
              
              {/* Secondary: Property type and unit count */}
              {loading ? (
                <Skeleton className="h-4 w-48" />
              ) : subtitle ? (
                <p className="text-sm text-muted-foreground">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>

          {/* Right: Identifier chips */}
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Badge variant="secondary" className="font-mono text-xs px-2.5 py-1">
              <span className="text-muted-foreground mr-1.5">BBL</span>
              {bbl}
            </Badge>
            {bin && (
              <Badge variant="secondary" className="font-mono text-xs px-2.5 py-1">
                <span className="text-muted-foreground mr-1.5">BIN</span>
                {bin}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
