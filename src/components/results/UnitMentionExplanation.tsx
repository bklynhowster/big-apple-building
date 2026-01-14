import { useState, useEffect } from 'react';
import { Wand2, Loader2, AlertCircle, ChevronDown, ChevronUp, AlertTriangle, ArrowRight, Home, Scale, Calendar, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface UnitMentionExplanationResponse {
  disclaimer: string;
  plain_english_summary: string;
  what_it_means_for_a_resident: string[];
  what_to_do_next: string[];
  key_details_extracted: {
    issue: string;
    location_in_text: string;
    law_or_code_cited: string;
    severity_class_if_any: string;
    dates: string[];
  };
  confidence: 'high' | 'medium' | 'low';
}

interface UnitMentionExplanationProps {
  agency: 'HPD' | 'DOB' | 'ECB' | '311' | string;
  recordId: string;
  recordDate?: string | null;
  recordStatus?: string | null;
  unitContext: string;
  rawText: string;
  compact?: boolean;
}

// Simple in-memory cache for explanations
const explanationCache = new Map<string, UnitMentionExplanationResponse>();

function getCacheKey(recordId: string, rawText: string): string {
  // Simple hash of rawText for cache key
  let hash = 0;
  for (let i = 0; i < rawText.length; i++) {
    const char = rawText.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `${recordId}-${hash}`;
}

export function UnitMentionExplanation({
  agency,
  recordId,
  recordDate,
  recordStatus,
  unitContext,
  rawText,
  compact = false,
}: UnitMentionExplanationProps) {
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<UnitMentionExplanationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const cacheKey = getCacheKey(recordId, rawText);

  // Check cache on mount
  useEffect(() => {
    const cached = explanationCache.get(cacheKey);
    if (cached) {
      setExplanation(cached);
    }
  }, [cacheKey]);

  const fetchExplanation = async () => {
    // Check cache first
    const cached = explanationCache.get(cacheKey);
    if (cached) {
      setExplanation(cached);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('explain-unit-mention', {
        body: {
          agency,
          recordId,
          recordDate,
          recordStatus,
          unitContext,
          rawText,
        },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to get explanation');
      }

      if (data.error) {
        throw new Error(data.error);
      }

      // Cache the result
      explanationCache.set(cacheKey, data);
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

  const confidenceColors = {
    high: 'bg-success/10 text-success border-success/30',
    medium: 'bg-warning/10 text-warning border-warning/30',
    low: 'bg-destructive/10 text-destructive border-destructive/30',
  };

  const severityColors: Record<string, string> = {
    A: 'bg-destructive text-destructive-foreground',
    B: 'bg-warning text-warning-foreground',
    C: 'bg-muted text-muted-foreground',
    unknown: 'bg-muted text-muted-foreground',
  };

  // Trigger button (not yet loaded)
  if (!explanation && !loading && !error) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={fetchExplanation}
        className={`gap-1.5 ${compact ? 'h-6 px-2 text-xs' : 'h-8'}`}
      >
        <Wand2 className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
        Explain
      </Button>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Analyzing record...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-2 py-2">
        <div className="flex items-center gap-2 text-destructive text-xs">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>{error}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchExplanation} className="h-6 text-xs">
          Try Again
        </Button>
      </div>
    );
  }

  if (!explanation) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
      {/* Header with toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full group"
      >
        <div className="flex items-center gap-2">
          <Wand2 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium uppercase tracking-wide">AI Explanation</span>
          <Badge variant="outline" className={`text-[10px] ${confidenceColors[explanation.confidence]}`}>
            {explanation.confidence}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setExplanation(null);
              explanationCache.delete(cacheKey);
            }}
            className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </Button>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Critical Disclaimer */}
          <Alert className="py-2 bg-warning/5 border-warning/30">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            <AlertDescription className="text-[11px] text-muted-foreground">
              {explanation.disclaimer}
            </AlertDescription>
          </Alert>

          {/* Plain English Summary */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Plain English Summary</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {explanation.plain_english_summary}
            </p>
          </div>

          {/* Key Details Extracted */}
          {explanation.key_details_extracted && (
            <div className="bg-muted/30 rounded-md p-2 space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Key Details</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {explanation.key_details_extracted.issue && explanation.key_details_extracted.issue !== 'Not stated' && (
                  <div>
                    <span className="text-muted-foreground">Issue:</span>{' '}
                    <span className="font-medium">{explanation.key_details_extracted.issue}</span>
                  </div>
                )}
                {explanation.key_details_extracted.location_in_text && explanation.key_details_extracted.location_in_text !== 'Not stated' && (
                  <div>
                    <span className="text-muted-foreground">Location:</span>{' '}
                    <span className="font-medium">{explanation.key_details_extracted.location_in_text}</span>
                  </div>
                )}
                {explanation.key_details_extracted.severity_class_if_any && explanation.key_details_extracted.severity_class_if_any !== 'unknown' && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Severity:</span>
                    <Badge className={`text-[10px] px-1 py-0 ${severityColors[explanation.key_details_extracted.severity_class_if_any] || severityColors.unknown}`}>
                      Class {explanation.key_details_extracted.severity_class_if_any}
                    </Badge>
                  </div>
                )}
                {explanation.key_details_extracted.law_or_code_cited && explanation.key_details_extracted.law_or_code_cited !== 'Not stated' && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Code:</span>{' '}
                    <span className="font-mono text-[10px]">{explanation.key_details_extracted.law_or_code_cited}</span>
                  </div>
                )}
                {explanation.key_details_extracted.dates && explanation.key_details_extracted.dates.length > 0 && (
                  <div className="col-span-2 flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Dates:</span>{' '}
                    <span>{explanation.key_details_extracted.dates.join(', ')}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* What it means for a resident */}
          {explanation.what_it_means_for_a_resident && explanation.what_it_means_for_a_resident.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium flex items-center gap-1">
                <Home className="h-3 w-3" />
                What This Means for a Resident
              </p>
              <ul className="space-y-0.5">
                {explanation.what_it_means_for_a_resident.map((item, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-primary">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* What to do next */}
          {explanation.what_to_do_next && explanation.what_to_do_next.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium flex items-center gap-1">
                <ArrowRight className="h-3 w-3" />
                What to Do Next
              </p>
              <ol className="space-y-0.5">
                {explanation.what_to_do_next.map((step, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-primary font-medium">{i + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <Separator className="my-2" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              explanationCache.delete(cacheKey);
              fetchExplanation();
            }}
            className="h-6 text-[10px] text-muted-foreground"
          >
            Regenerate
          </Button>
        </div>
      )}
    </div>
  );
}
