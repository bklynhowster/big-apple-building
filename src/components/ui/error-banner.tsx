import { AlertCircle, Copy, Check, RefreshCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import type { ApiError } from '@/types/api-error';

interface ErrorBannerProps {
  error: string | ApiError;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorBanner({ error, onRetry, retrying = false }: ErrorBannerProps) {
  const [copied, setCopied] = useState(false);
  
  const isApiError = typeof error === 'object' && error !== null;
  const userMessage = isApiError ? error.userMessage : error;
  const requestId = isApiError ? error.requestId : undefined;
  
  const handleCopyRequestId = async () => {
    if (!requestId) return;
    
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
      toast({
        title: 'Copied',
        description: 'Request ID copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Failed to copy',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            {typeof userMessage === 'string' ? userMessage : 'An error occurred'}
          </p>
          {requestId && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Request ID: <code className="font-mono">{requestId}</code>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleCopyRequestId}
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          )}
        </div>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={retrying}
            className="gap-1.5 flex-shrink-0"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Retrying...' : 'Retry'}
          </Button>
        )}
      </div>
    </div>
  );
}
