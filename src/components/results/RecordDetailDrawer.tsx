import { ExternalLink, X, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';

export type RecordType = 'violation' | 'ecb' | 'permit' | 'safety' | 'hpd-violation' | 'hpd-complaint' | '311';

interface RecordDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordType: RecordType;
  record: Record<string, unknown> | null;
}

// Build external links based on record type
function getExternalLinks(recordType: RecordType, record: Record<string, unknown>): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  
  const raw = record.raw as Record<string, unknown> | undefined;
  const bin = record.bin || raw?.bin;
  const bbl = record.bbl || raw?.bbl;
  const jobNumber = record.jobNumber || record.job_number || raw?.job__;
  const ecbNumber = record.ecbNumber || record.ecb_violation_number || raw?.ecb_violation_number;
  
  switch (recordType) {
    case 'violation':
    case 'ecb':
    case 'permit':
    case 'safety':
      // BIS Property Profile
      if (bin) {
        links.push({
          label: 'View in BIS',
          url: `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${bin}`,
        });
      }
      // DOB NOW
      if (jobNumber) {
        links.push({
          label: 'View in DOB NOW',
          url: `https://a810-dobnow.nyc.gov/publish/#!/job/${jobNumber}`,
        });
      }
      // OATH for ECB
      if (recordType === 'ecb' && ecbNumber) {
        links.push({
          label: 'View in OATH',
          url: `https://a820-ecbpublic.nyc.gov/PublicAccess/ViewViolation.aspx?vn=${ecbNumber}`,
        });
      }
      break;
    case 'hpd-violation':
    case 'hpd-complaint':
      // HPD Online
      if (bbl) {
        const borough = String(bbl).charAt(0);
        const block = String(bbl).substring(1, 6);
        const lot = String(bbl).substring(6, 10);
        links.push({
          label: 'View in HPD Online',
          url: `https://hpdonline.nyc.gov/HPDonline/provide_address.aspx?p1=${borough}&p2=${block}&p3=${lot}`,
        });
      }
      break;
    case '311':
      const uniqueKey = record.recordId || record.unique_key;
      if (uniqueKey) {
        links.push({
          label: 'View 311 Details',
          url: `https://portal.311.nyc.gov/article/?kanession=sr-${uniqueKey}`,
        });
      }
      break;
  }
  
  return links;
}

function formatDate(value: unknown): string {
  if (!value) return 'N/A';
  try {
    return new Date(String(value)).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return String(value);
  }
}

function formatCurrency(value: unknown): string {
  if (value === null || value === undefined) return 'N/A';
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

function getStatusVariant(status: string): 'destructive' | 'secondary' | 'outline' {
  const s = status?.toLowerCase();
  if (s === 'open' || s === 'active') return 'destructive';
  if (s === 'closed' || s === 'resolved') return 'secondary';
  return 'outline';
}

function getRecordTypeLabel(type: RecordType): string {
  const labels: Record<RecordType, string> = {
    violation: 'DOB Violation',
    ecb: 'ECB Summons',
    permit: 'DOB Permit',
    safety: 'DOB Safety',
    'hpd-violation': 'HPD Violation',
    'hpd-complaint': 'HPD Complaint',
    '311': '311 Request',
  };
  return labels[type] || type;
}

// Key fields by record type
function getKeyFields(recordType: RecordType, record: Record<string, unknown>): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  
  // Common fields
  const recordId = record.recordId || record.record_id;
  if (recordId) fields.push({ label: 'Record ID', value: String(recordId) });
  
  const status = record.status;
  if (status) fields.push({ label: 'Status', value: String(status).toUpperCase() });
  
  const issueDate = record.issueDate || record.issue_date;
  if (issueDate) fields.push({ label: 'Issue Date', value: formatDate(issueDate) });
  
  const resolvedDate = record.resolvedDate || record.resolved_date;
  if (resolvedDate) fields.push({ label: 'Resolved Date', value: formatDate(resolvedDate) });
  
  const category = record.category;
  if (category) fields.push({ label: 'Category', value: String(category) });
  
  // Type-specific fields
  switch (recordType) {
    case 'ecb':
      if (record.severity) fields.push({ label: 'Severity', value: String(record.severity) });
      if (record.penaltyAmount !== null && record.penaltyAmount !== undefined) {
        fields.push({ label: 'Penalty Amount', value: formatCurrency(record.penaltyAmount) });
      }
      if (record.balanceDue !== null && record.balanceDue !== undefined) {
        fields.push({ label: 'Balance Due', value: formatCurrency(record.balanceDue) });
      }
      if (record.amountPaid !== null && record.amountPaid !== undefined) {
        fields.push({ label: 'Amount Paid', value: formatCurrency(record.amountPaid) });
      }
      break;
    case 'permit':
      if (record.permitType) fields.push({ label: 'Permit Type', value: String(record.permitType) });
      if (record.workType) fields.push({ label: 'Work Type', value: String(record.workType) });
      if (record.jobNumber) fields.push({ label: 'Job Number', value: String(record.jobNumber) });
      if (record.expirationDate) fields.push({ label: 'Expiration', value: formatDate(record.expirationDate) });
      if (record.applicantName) fields.push({ label: 'Applicant', value: String(record.applicantName) });
      if (record.ownerName) fields.push({ label: 'Owner', value: String(record.ownerName) });
      break;
    case 'hpd-violation':
      if (record.violationClass) fields.push({ label: 'Class', value: `Class ${record.violationClass}` });
      break;
    case '311':
      if (record.agency) fields.push({ label: 'Agency', value: String(record.agency) });
      if (record.complaintType) fields.push({ label: 'Complaint Type', value: String(record.complaintType) });
      break;
  }
  
  return fields;
}

export function RecordDetailDrawer({ open, onOpenChange, recordType, record }: RecordDetailDrawerProps) {
  const [rawExpanded, setRawExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  
  if (!record) return null;
  
  const externalLinks = getExternalLinks(recordType, record);
  const keyFields = getKeyFields(recordType, record);
  const description = record.description || record.full_description;
  const status = String(record.status || 'unknown');
  const rawData = record.raw || record;
  
  const handleCopyRaw = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rawData, null, 2));
      setCopied(true);
      toast({ title: 'Copied to clipboard' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Failed to copy', variant: 'destructive' });
    }
  };
  
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
        <SheetHeader className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-xs">
                  {getRecordTypeLabel(recordType)}
                </Badge>
                <Badge variant={getStatusVariant(status)} className="capitalize">
                  {status}
                </Badge>
              </div>
              <SheetTitle className="text-lg font-semibold">
                {String(record.recordId || record.record_id || 'Record Details')}
              </SheetTitle>
            </div>
          </div>
          {description && (
            <SheetDescription className="text-sm text-muted-foreground text-left">
              Full details for this {getRecordTypeLabel(recordType).toLowerCase()}
            </SheetDescription>
          )}
        </SheetHeader>
        
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 py-4">
            {/* Key Fields */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Key Information</h4>
              <div className="grid gap-2">
                {keyFields.map((field, i) => (
                  <div key={i} className="flex justify-between items-start py-1.5 border-b border-border/50 last:border-0">
                    <span className="text-sm text-muted-foreground">{field.label}</span>
                    <span className="text-sm font-medium text-right max-w-[60%]">{field.value}</span>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Full Description */}
            {description && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Description</h4>
                <p className="text-sm leading-relaxed bg-muted/30 p-3 rounded-md">
                  {String(description)}
                </p>
              </div>
            )}
            
            {/* External Links */}
            {externalLinks.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">External Links</h4>
                <div className="flex flex-wrap gap-2">
                  {externalLinks.map((link, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      asChild
                    >
                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                        {link.label}
                      </a>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            
            <Separator />
            
            {/* Raw Data */}
            <div className="space-y-3">
              <button
                onClick={() => setRawExpanded(!rawExpanded)}
                className="flex items-center justify-between w-full group"
              >
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
                  Raw Data
                </h4>
                {rawExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              
              {rawExpanded && (
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2 h-7 gap-1"
                    onClick={handleCopyRaw}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                  <pre className="text-xs bg-muted/50 p-3 rounded-md overflow-auto max-h-80 font-mono">
                    {JSON.stringify(rawData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
