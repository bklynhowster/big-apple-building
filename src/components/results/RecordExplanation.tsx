import { useState, useMemo } from 'react';
import { Lightbulb, Loader2, AlertCircle, ChevronDown, ChevronUp, BookOpen, ArrowRight, Users, HelpCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import type { RecordType } from './RecordDetailDrawer';

interface ExplanationResponse {
  summary: string;
  meaning: string[];
  why_it_matters: string[];
  who_must_act: string;
  next_steps: string[];
  glossary: Record<string, string>;
  unknowns: string[];
  confidence: 'High' | 'Medium' | 'Low';
}

interface RecordExplanationProps {
  recordType: RecordType;
  record: Record<string, unknown>;
  address?: string;
}

// Record types that are typically administrative with no narrative
const ADMINISTRATIVE_RECORD_TYPES = new Set([
  'SC', // DOB Status Change
  'NB', // New Building (can be narrative-less)
  'DM', // Demolition (often minimal)
]);

// Minimum character threshold for meaningful narrative
const MIN_NARRATIVE_LENGTH = 50;

// Fields that contain meaningful narrative text (primary — longer descriptions)
const NARRATIVE_FIELDS = [
  'description', 'full_description', 'job_description', 'jobdescription',
  'violation_description', 'ecb_violation_description',
  'violation_category', 'violation_type',
  'complaint_type', 'problem_description', 'descriptor',
  'resolution_description', 'comments', 'narrative',
  'novdescription', 'infraction_code1', 'section_of_law',
];

// Structured fields that, when combined, can still give AI enough context
// (permits, filings, etc. with short codes but meaningful structured data)
const STRUCTURED_FIELDS = [
  'category', 'work_type', 'permit_type', 'permit_subtype', 'filing_status',
  'applicant_s_first_name', 'applicant_s_last_name',
  'owner_s_first_name', 'owner_s_last_name',
  'applicant', 'owner', 'applicant_name', 'owner_name',
  'status', 'type', 'job_type',
];

interface EligibilityResult {
  isEligible: boolean;
  reason: string;
  narrativeText: string | null;
}

function checkAIEligibility(record: Record<string, unknown>, recordType: RecordType): EligibilityResult {
  const raw = record.raw as Record<string, unknown> | undefined;
  const data = raw || record;

  // Check for job type that's typically administrative
  const jobType = (data.job_type || data.jobType || data.type || '') as string;
  const jobTypeUpper = String(jobType).toUpperCase().trim();

  // Collect all narrative text from the record (primary fields with >10 char values)
  let narrativeText = '';
  for (const field of NARRATIVE_FIELDS) {
    const value = data[field] || data[field.toLowerCase()] || data[field.replace(/_/g, '')];
    if (value && typeof value === 'string' && value.trim().length > 10) {
      narrativeText += ' ' + value.trim();
    }
  }
  narrativeText = narrativeText.trim();

  // If primary narrative fields meet threshold, we're good
  if (narrativeText.length >= MIN_NARRATIVE_LENGTH) {
    return {
      isEligible: true,
      reason: '',
      narrativeText,
    };
  }

  // Fallback: for structured records (permits, filings, violations), combine
  // shorter structured fields. A plumbing permit with applicant + dates + category
  // IS meaningful enough for AI to explain — even without a long description.
  let structuredText = narrativeText; // start with whatever narrative we found
  for (const field of STRUCTURED_FIELDS) {
    const value = data[field] || data[field.toLowerCase()] || data[field.replace(/_/g, '')];
    if (value && typeof value === 'string' && value.trim().length > 1) {
      structuredText += ` ${field}: ${value.trim()}`;
    }
  }
  // Also grab the short description/category even under 10 chars
  for (const field of NARRATIVE_FIELDS) {
    const value = data[field] || data[field.toLowerCase()] || data[field.replace(/_/g, '')];
    if (value && typeof value === 'string' && value.trim().length > 1 && value.trim().length <= 10) {
      structuredText += ` ${field}: ${value.trim()}`;
    }
  }
  structuredText = structuredText.trim();

  // If combined structured fields give us at least 20 chars, allow it —
  // the AI will get the full record via buildRawText() anyway
  if (structuredText.length >= 20) {
    return {
      isEligible: true,
      reason: '',
      narrativeText: structuredText,
    };
  }

  // Check if it's an administrative filing type
  if (ADMINISTRATIVE_RECORD_TYPES.has(jobTypeUpper)) {
    return {
      isEligible: false,
      reason: `AI summary not available: this ${jobTypeUpper} filing is an administrative record and does not include descriptive text to summarize.`,
      narrativeText: null,
    };
  }

  return {
    isEligible: false,
    reason: 'AI summary not available: this record does not contain sufficient narrative text to summarize. Only status fields and identifiers are present.',
    narrativeText: null,
  };
}

function getAgencyFromRecordType(recordType: RecordType): string {
  switch (recordType) {
    case 'violation':
    case 'permit':
    case 'safety':
      return 'DOB';
    case 'ecb':
      return 'ECB/OATH';
    case 'hpd-violation':
    case 'hpd-complaint':
      return 'HPD';
    case '311':
      return '311';
    default:
      return 'NYC';
  }
}

function getRecordTypeLabel(recordType: RecordType): string {
  const labels: Record<RecordType, string> = {
    violation: 'DOB Violation',
    ecb: 'ECB Summons',
    permit: 'DOB Permit',
    safety: 'DOB Safety Violation',
    'hpd-violation': 'HPD Violation',
    'hpd-complaint': 'HPD Complaint',
    '311': '311 Service Request',
  };
  return labels[recordType] || recordType;
}

function buildRawText(record: Record<string, unknown>): string {
  const raw = record.raw as Record<string, unknown> | undefined;
  const data = raw || record;

  // Build a readable text from key fields
  const lines: string[] = [];

  if (data.description || data.full_description) {
    lines.push(`Description: ${data.description || data.full_description}`);
  }
  if (data.status) {
    lines.push(`Status: ${data.status}`);
  }
  if (data.category) {
    lines.push(`Category: ${data.category}`);
  }
  // Permit-specific fields
  if (data.permit_type) {
    lines.push(`Permit Type: ${data.permit_type}`);
  }
  if (data.work_type) {
    lines.push(`Work Type: ${data.work_type}`);
  }
  if (data.permit_subtype) {
    lines.push(`Permit Subtype: ${data.permit_subtype}`);
  }
  if (data.filing_status) {
    lines.push(`Filing Status: ${data.filing_status}`);
  }
  // Applicant/owner
  const applicant = data.applicant_s_first_name || data.applicant || data.applicant_name;
  const applicantLast = data.applicant_s_last_name;
  if (applicant) {
    lines.push(`Applicant: ${applicant}${applicantLast ? ' ' + applicantLast : ''}`);
  }
  const owner = data.owner_s_first_name || data.owner || data.owner_name;
  const ownerLast = data.owner_s_last_name;
  if (owner) {
    lines.push(`Owner: ${owner}${ownerLast ? ' ' + ownerLast : ''}`);
  }
  // Dates
  if (data.issuance_date || data.issue_date || data.issued_date) {
    lines.push(`Issue Date: ${data.issuance_date || data.issue_date || data.issued_date}`);
  }
  if (data.expiration_date) {
    lines.push(`Expiration Date: ${data.expiration_date}`);
  }
  // Violation/penalty fields
  if (data.violationClass || data.violation_class) {
    lines.push(`Class: ${data.violationClass || data.violation_class}`);
  }
  if (data.penaltyAmount || data.penalty_imposed) {
    lines.push(`Penalty: $${data.penaltyAmount || data.penalty_imposed}`);
  }
  if (data.balanceDue || data.amount_due) {
    lines.push(`Balance Due: $${data.balanceDue || data.amount_due}`);
  }
  if (data.severity || data.infraction_code1) {
    lines.push(`Severity/Code: ${data.severity || data.infraction_code1}`);
  }
  // Violation category/type (DOB violations)
  if (data.violation_category) {
    lines.push(`Violation Category: ${data.violation_category}`);
  }
  if (data.violation_type) {
    lines.push(`Violation Type: ${data.violation_type}`);
  }

  // If we have very little, just stringify the whole thing
  if (lines.length < 2) {
    return JSON.stringify(data, null, 2);
  }

  return lines.join('\n');
}

export function RecordExplanation({ recordType, record, address }: RecordExplanationProps) {
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<ExplanationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [glossaryExpanded, setGlossaryExpanded] = useState(false);

  // Check eligibility once on mount
  const eligibility = useMemo(() => checkAIEligibility(record, recordType), [record, recordType]);

  const fetchExplanation = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const raw = record.raw as Record<string, unknown> | undefined;
      const unit = record.unit || raw?.apartment || raw?.unit || '';
      const date = record.issueDate || record.issue_date || raw?.issue_date || '';
      
      const { data, error: fnError } = await supabase.functions.invoke('explain-record', {
        body: {
          agency: getAgencyFromRecordType(recordType),
          recordType: getRecordTypeLabel(recordType),
          address: address || record.address || 'Unknown',
          unit: unit ? String(unit) : undefined,
          date: date ? String(date) : undefined,
          rawText: buildRawText(record),
          otherFields: raw || record,
        },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to get explanation');
      }

      if (data.error) {
        throw new Error(data.error);
      }

      setExplanation(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get explanation';
      setError(message);
      toast({
        title: 'Explanation failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const confidenceColor = {
    High: 'bg-green-500/10 text-green-700 border-green-200',
    Medium: 'bg-yellow-500/10 text-yellow-700 border-yellow-200',
    Low: 'bg-red-500/10 text-red-700 border-red-200',
  };

  // Always render the AI section - never silently hide it
  return (
    <div className="space-y-3 bg-muted/30 rounded-lg p-4 border border-border/50">
      {/* Header - always visible */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-medium">AI Explanation</h4>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground">
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-xs">
                <strong>What AI can summarize:</strong> Violations, complaints, permits with detailed descriptions, 
                job filings with work descriptions, and 311 requests with narratives.
              </p>
              <p className="text-xs mt-1 text-muted-foreground">
                Administrative records without narrative text (e.g., status changes, simple filings) 
                cannot be meaningfully summarized.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        
        {explanation && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Not eligible - show explanation */}
      {!eligibility.isEligible && !loading && !explanation && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground py-2">
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground/70" />
          <p>{eligibility.reason}</p>
        </div>
      )}

      {/* Eligible but not yet requested */}
      {eligibility.isEligible && !explanation && !loading && !error && (
        <Button
          variant="outline"
          size="sm"
          onClick={fetchExplanation}
          className="gap-2 w-full"
        >
          <Lightbulb className="h-4 w-4" />
          Explain in Plain English
        </Button>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Analyzing record...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
          {eligibility.isEligible && (
            <Button variant="outline" size="sm" onClick={fetchExplanation}>
              Try Again
            </Button>
          )}
        </div>
      )}

      {/* Explanation content */}
      {explanation && expanded && (
        <div className="space-y-4 border-t border-border/50 pt-4 overflow-hidden" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
          {/* Confidence badge */}
          <Badge variant="outline" className={confidenceColor[explanation.confidence]}>
            {explanation.confidence} Confidence
          </Badge>

          {/* Summary */}
          <div className="space-y-1">
            <p className="text-sm font-medium">Summary</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {explanation.summary}
            </p>
          </div>

          {/* What it means */}
          {explanation.meaning.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                What This Means
              </p>
              <ul className="space-y-1">
                {explanation.meaning.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex gap-2">
                    <span className="text-primary shrink-0">•</span>
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Why it matters */}
          {explanation.why_it_matters.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5" />
                Why It Matters
              </p>
              <ul className="space-y-1">
                {explanation.why_it_matters.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex gap-2">
                    <span className="text-primary shrink-0">•</span>
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Who must act */}
          {explanation.who_must_act && (
            <div className="space-y-1">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Who Must Act
              </p>
              <p className="text-sm text-muted-foreground">
                {explanation.who_must_act}
              </p>
            </div>
          )}

          {/* Next steps */}
          {explanation.next_steps.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" />
                Next Steps
              </p>
              <ol className="space-y-1">
                {explanation.next_steps.map((step, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex gap-2">
                    <span className="text-primary font-medium shrink-0">{i + 1}.</span>
                    <span className="min-w-0">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Unknowns */}
          {explanation.unknowns.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5 text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5" />
                Not Stated in Record
              </p>
              <ul className="space-y-1">
                {explanation.unknowns.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground/70 flex gap-2">
                    <span className="shrink-0">•</span>
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Glossary */}
          {Object.keys(explanation.glossary).length > 0 && (
            <div className="space-y-2">
              <button
                onClick={() => setGlossaryExpanded(!glossaryExpanded)}
                className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Glossary ({Object.keys(explanation.glossary).length} terms)
                {glossaryExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              {glossaryExpanded && (
                <div className="bg-muted/50 rounded-md p-3 space-y-2">
                  {Object.entries(explanation.glossary).map(([term, def]) => (
                    <div key={term} className="text-sm">
                      <span className="font-medium">{term}:</span>{' '}
                      <span className="text-muted-foreground">{def}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Separator />
          
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchExplanation}
              className="text-xs"
            >
              Regenerate Explanation
            </Button>
            <p className="text-xs text-muted-foreground">
              AI-generated • Verify against official NYC records
            </p>
          </div>
        </div>
      )}

      {/* Collapsed state with summary peek */}
      {explanation && !expanded && (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {explanation.summary}
        </p>
      )}
    </div>
  );
}
