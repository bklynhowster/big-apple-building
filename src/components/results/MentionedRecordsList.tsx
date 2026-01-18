import { useState } from 'react';
import { ExternalLink, Copy, ChevronRight, Check, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { CombinedUnitStats } from '@/hooks/useUnitMentions';

interface MentionedRecordsListProps {
  unitLabel: string;
  unitMentions: CombinedUnitStats;
  onScrollToSection?: (sectionId: string, recordId?: string) => void;
}

type DatasetType = 'dob-violation' | 'ecb' | 'permit' | 'hpd';

const DATASET_LABELS: Record<DatasetType, string> = {
  'dob-violation': 'DOB Violations',
  'ecb': 'ECB Violations',
  'permit': 'DOB Permits',
  'hpd': 'HPD',
};

const SECTION_IDS: Record<DatasetType, string> = {
  'dob-violation': 'dob-violations',
  'ecb': 'ecb-violations',
  'permit': 'dob-permits',
  'hpd': 'hpd-records',
};

// HPD violation portal link (when available)
function getHPDPortalLink(_violationId: string): string | null {
  // HPD doesn't have stable deep links for individual violations
  // but we can link to their search page
  return `https://a836-housing.nyc.gov/housingconnect/`;
}

// DOB portal links
function getDOBPortalLink(recordType: 'violation' | 'ecb' | 'permit', _id: string, jobNumber?: string): string | null {
  if (recordType === 'permit' && jobNumber) {
    return `https://a810-bisweb.nyc.gov/bisweb/JobsQueryByNumberServlet?passjobnumber=${jobNumber}`;
  }
  // DOB BIS doesn't have stable violation deep links
  return null;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-7 px-2 text-xs"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 mr-1" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3 mr-1" />
          {label}
        </>
      )}
    </Button>
  );
}

interface MentionRowProps {
  dataset: DatasetType;
  recordId: string;
  label: string;
  status?: string;
  issueDate?: string | null;
  snippet?: string | null;
  description?: string | null;
  jobNumber?: string | null;
  sourceField?: string | null;
  confidence?: string | null;
  onScrollToSection?: (sectionId: string, recordId?: string) => void;
}

function MentionRow({
  dataset,
  recordId,
  label,
  status,
  issueDate,
  snippet,
  description,
  jobNumber,
  sourceField,
  confidence,
  onScrollToSection,
}: MentionRowProps) {
  const hasExcerpt = Boolean(snippet || description);
  
  const handleViewInPanel = () => {
    const sectionId = SECTION_IDS[dataset];
    onScrollToSection?.(sectionId, recordId);
    
    // Scroll to section
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  
  // Determine portal link
  let portalLink: string | null = null;
  if (dataset === 'hpd') {
    portalLink = getHPDPortalLink(recordId);
  } else if (dataset === 'dob-violation') {
    portalLink = getDOBPortalLink('violation', recordId);
  } else if (dataset === 'ecb') {
    portalLink = getDOBPortalLink('ecb', recordId);
  } else if (dataset === 'permit') {
    portalLink = getDOBPortalLink('permit', recordId, jobNumber ?? undefined);
  }
  
  return (
    <div className="flex flex-col gap-2 p-3 rounded-md border border-border bg-card hover:bg-muted/30 transition-colors">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-xs font-medium">
          {DATASET_LABELS[dataset]}
        </Badge>
        <span className="text-sm font-medium">{label}</span>
        {status && (
          <Badge 
            variant={status.toLowerCase().includes('open') ? 'destructive' : 'secondary'} 
            className="text-xs"
          >
            {status}
          </Badge>
        )}
        {issueDate && (
          <span className="text-xs text-muted-foreground">
            {new Date(issueDate).toLocaleDateString('en-US')}
          </span>
        )}
        {confidence && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-xs",
                    confidence === 'high' && "border-green-500 text-green-600",
                    confidence === 'medium' && "border-yellow-500 text-yellow-600",
                    confidence === 'low' && "border-muted-foreground"
                  )}
                >
                  {confidence}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Extraction confidence: {confidence}</p>
                {sourceField && <p className="text-xs">Source: {sourceField}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      
      {hasExcerpt ? (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {snippet || description}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          {dataset === 'hpd' 
            ? 'Unit mention inferred from apartment field (no narrative excerpt available)'
            : 'No excerpt available'
          }
        </p>
      )}
      
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={handleViewInPanel}
          className="h-7 px-2 text-xs"
        >
          <ChevronRight className="h-3 w-3 mr-1" />
          View in dataset panel
        </Button>
        
        {portalLink && (
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="h-7 px-2 text-xs"
          >
            <a href={portalLink} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" />
              Open on NYC portal
            </a>
          </Button>
        )}
        
        <CopyButton text={recordId} label="Copy ID" />
      </div>
    </div>
  );
}

export function MentionedRecordsList({ 
  unitLabel, 
  unitMentions,
  onScrollToSection 
}: MentionedRecordsListProps) {
  // Build a unified list of all mentioned records
  const allMentions: Array<{
    dataset: DatasetType;
    recordId: string;
    label: string;
    status?: string;
    issueDate?: string | null;
    snippet?: string | null;
    description?: string | null;
    jobNumber?: string | null;
    sourceField?: string | null;
    confidence?: string | null;
  }> = [];
  
  // DOB Violations
  for (const ref of unitMentions.violationRefs.filter(r => r.type === 'dob-violation')) {
    allMentions.push({
      dataset: 'dob-violation',
      recordId: ref.id,
      label: ref.label,
      status: ref.status,
      issueDate: ref.issueDate,
      snippet: ref.snippet,
      description: ref.description,
      sourceField: ref.sourceField,
      confidence: ref.confidence,
    });
  }
  
  // ECB Violations
  for (const ref of unitMentions.violationRefs.filter(r => r.type === 'ecb')) {
    allMentions.push({
      dataset: 'ecb',
      recordId: ref.id,
      label: ref.label,
      status: ref.status,
      issueDate: ref.issueDate,
      snippet: ref.snippet,
      description: ref.description,
      sourceField: ref.sourceField,
      confidence: ref.confidence,
    });
  }
  
  // Permits
  for (const ref of unitMentions.permitRefs) {
    allMentions.push({
      dataset: 'permit',
      recordId: ref.id,
      label: ref.label,
      status: ref.status,
      issueDate: ref.issueDate,
      snippet: ref.snippet,
      description: ref.description,
      jobNumber: ref.jobNumber,
      sourceField: ref.sourceField,
      confidence: ref.confidence,
    });
  }
  
  // HPD (from sourceRefs)
  for (const ref of unitMentions.sourceRefs.filter(r => r.type === 'hpd')) {
    allMentions.push({
      dataset: 'hpd',
      recordId: ref.id,
      label: ref.label,
      // HPD refs from sourceRefs don't have detailed fields
    });
  }
  
  if (allMentions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center">
          <Info className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No records found mentioning Unit {unitLabel}.
          </p>
        </CardContent>
      </Card>
    );
  }
  
  // Group by dataset for summary badges
  const countsByDataset: Record<DatasetType, number> = {
    'dob-violation': allMentions.filter(m => m.dataset === 'dob-violation').length,
    'ecb': allMentions.filter(m => m.dataset === 'ecb').length,
    'permit': allMentions.filter(m => m.dataset === 'permit').length,
    'hpd': allMentions.filter(m => m.dataset === 'hpd').length,
  };
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Mentioned Records</CardTitle>
          <div className="flex flex-wrap gap-1">
            {countsByDataset['dob-violation'] > 0 && (
              <Badge variant="outline" className="text-xs">DOB: {countsByDataset['dob-violation']}</Badge>
            )}
            {countsByDataset['ecb'] > 0 && (
              <Badge variant="outline" className="text-xs">ECB: {countsByDataset['ecb']}</Badge>
            )}
            {countsByDataset['permit'] > 0 && (
              <Badge variant="outline" className="text-xs">Permits: {countsByDataset['permit']}</Badge>
            )}
            {countsByDataset['hpd'] > 0 && (
              <Badge variant="outline" className="text-xs">HPD: {countsByDataset['hpd']}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {allMentions.map((mention, idx) => (
          <MentionRow
            key={`${mention.dataset}-${mention.recordId}-${idx}`}
            {...mention}
            onScrollToSection={onScrollToSection}
          />
        ))}
      </CardContent>
    </Card>
  );
}
