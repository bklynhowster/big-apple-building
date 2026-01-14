import { useState } from 'react';
import { Lightbulb, Loader2, AlertCircle, ChevronDown, ChevronUp, BookOpen, ArrowRight, Users, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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

  if (!explanation && !loading && !error) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={fetchExplanation}
        className="gap-2 w-full"
      >
        <Lightbulb className="h-4 w-4" />
        Explain in Plain English
      </Button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Analyzing record...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
        <Button variant="outline" size="sm" onClick={fetchExplanation}>
          Try Again
        </Button>
      </div>
    );
  }

  if (!explanation) return null;

  return (
    <div className="space-y-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full group"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-medium uppercase tracking-wide">AI Explanation</h4>
          <Badge variant="outline" className={confidenceColor[explanation.confidence]}>
            {explanation.confidence} Confidence
          </Badge>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="space-y-4 pl-6 border-l-2 border-primary/20">
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
                    <span className="text-primary">•</span>
                    {item}
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
                    <span className="text-primary">•</span>
                    {item}
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
                    <span className="text-primary font-medium">{i + 1}.</span>
                    {step}
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
                    <span>•</span>
                    {item}
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
                <div className="bg-muted/30 rounded-md p-3 space-y-2">
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
          
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchExplanation}
            className="text-xs"
          >
            Regenerate Explanation
          </Button>
        </div>
      )}
    </div>
  );
}
