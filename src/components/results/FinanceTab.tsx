import { DollarSign, FileText, Building, Clock, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface FinanceTabProps {
  bbl: string;
  address?: string;
}

interface PlaceholderSectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  fields: { label: string; placeholder: string }[];
}

function PlaceholderSection({ title, description, icon, fields }: PlaceholderSectionProps) {
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
          <Badge variant="outline" className="ml-2 text-xs">Coming Soon</Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map((field) => (
            <div key={field.label} className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{field.label}</p>
              <p className="text-sm text-muted-foreground/50 italic">{field.placeholder}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function FinanceTab({ bbl, address }: FinanceTabProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-muted-foreground" />
          Financial Records
        </h2>
        <p className="text-sm text-muted-foreground">
          Ownership, mortgages, and liens for this property
        </p>
      </div>

      {/* Coming soon notice */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Financial data integration is coming soon. This section will display ownership history, 
          mortgage records, and lien information from NYC ACRIS and DOF databases.
        </AlertDescription>
      </Alert>

      {/* Placeholder sections */}
      <div className="space-y-4">
        {/* Ownership */}
        <PlaceholderSection
          title="Ownership"
          description="Current and historical ownership information from deed records"
          icon={<Building className="h-4 w-4" />}
          fields={[
            { label: 'Current Owner', placeholder: 'Owner name will appear here' },
            { label: 'Ownership Type', placeholder: 'Individual / Corporation / Trust' },
            { label: 'Last Transfer Date', placeholder: 'Date of last deed transfer' },
            { label: 'Last Sale Price', placeholder: 'Recorded sale amount' },
          ]}
        />

        {/* Mortgages */}
        <PlaceholderSection
          title="Mortgages & Liens"
          description="Active and satisfied mortgage records from ACRIS"
          icon={<FileText className="h-4 w-4" />}
          fields={[
            { label: 'Active Mortgages', placeholder: 'Number of open mortgages' },
            { label: 'Primary Lender', placeholder: 'Lender name' },
            { label: 'Original Amount', placeholder: 'Mortgage principal' },
            { label: 'Recording Date', placeholder: 'Date recorded' },
          ]}
        />

        {/* Tax Liens */}
        <PlaceholderSection
          title="Tax Liens"
          description="Open and released tax liens from NYC Department of Finance"
          icon={<Clock className="h-4 w-4" />}
          fields={[
            { label: 'Lien Status', placeholder: 'Open / Released / None' },
            { label: 'Lien Amount', placeholder: 'Total lien amount' },
            { label: 'Lien Date', placeholder: 'Date filed' },
            { label: 'Satisfaction Date', placeholder: 'Date released (if applicable)' },
          ]}
        />
      </div>

      {/* Data source note */}
      <p className="text-xs text-muted-foreground">
        Data sourced from NYC ACRIS (Automated City Register Information System) and 
        NYC Department of Finance. Updates may take 2-4 weeks to reflect recent transactions.
      </p>
    </div>
  );
}
