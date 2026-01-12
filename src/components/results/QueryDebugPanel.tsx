import { useState } from 'react';
import { ChevronDown, ChevronUp, Bug, Trash2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useQueryDebug, type QueryLogEntry } from '@/contexts/QueryDebugContext';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function StatusIcon({ status }: { status: QueryLogEntry['status'] }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground animate-pulse" />;
  }
}

function QueryLogItem({ log }: { log: QueryLogEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="border border-border rounded-md p-2 bg-card text-xs font-mono">
      <div 
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <StatusIcon status={log.status} />
        <span className="text-muted-foreground">{formatTime(log.timestamp)}</span>
        <Badge variant="outline" className="text-xs py-0">
          {log.endpoint}
        </Badge>
        {log.scope && (
          <Badge 
            variant={log.scope === 'unit' ? 'default' : 'secondary'} 
            className="text-xs py-0"
          >
            {log.scope}
          </Badge>
        )}
        {log.responseTime && (
          <span className="text-muted-foreground ml-auto">{log.responseTime}ms</span>
        )}
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </div>
      
      {isExpanded && (
        <div className="mt-2 space-y-2 pl-6">
          <div>
            <span className="text-muted-foreground">URL: </span>
            <span className="text-primary break-all">{log.requestUrl}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Params: </span>
            <pre className="text-foreground mt-1 whitespace-pre-wrap">
              {JSON.stringify(log.params, null, 2)}
            </pre>
          </div>
          {log.dataset && (
            <div>
              <span className="text-muted-foreground">Dataset: </span>
              <span className="text-foreground">{log.dataset}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QueryDebugPanel() {
  const { logs, contextBbl, billingBbl, bin, isDebugMode, clearLogs } = useQueryDebug();
  const [isOpen, setIsOpen] = useState(true);

  if (!isDebugMode) {
    return null;
  }

  // Determine if we're on a unit page
  const lot = contextBbl ? parseInt(contextBbl.slice(6), 10) : 0;
  const isUnitLot = lot >= 1001 && lot <= 6999;
  const isBillingLot = lot >= 7501 && lot <= 7599;

  return (
    <Card className="border-yellow-500/50 bg-yellow-500/5">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="py-3">
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between cursor-pointer">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Bug className="h-4 w-4 text-yellow-500" />
                Query Debug Panel
                <Badge variant="outline" className="text-xs">
                  {logs.length} queries
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearLogs();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </div>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Context Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 bg-muted/50 rounded-lg text-sm font-mono">
              <div>
                <span className="text-muted-foreground">Context BBL: </span>
                <span className="text-foreground font-semibold">{contextBbl || 'N/A'}</span>
                {isUnitLot && (
                  <Badge variant="default" className="ml-2 text-xs">Unit</Badge>
                )}
                {isBillingLot && (
                  <Badge variant="secondary" className="ml-2 text-xs">Billing</Badge>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Billing BBL: </span>
                <span className="text-foreground">{billingBbl || 'N/A'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">BIN: </span>
                <span className="text-foreground">{bin || 'N/A'}</span>
              </div>
            </div>

            {/* Query Logs */}
            <div>
              <h4 className="text-sm font-medium mb-2">Recent Queries</h4>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No queries logged yet</p>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2 pr-4">
                    {logs.slice().reverse().map(log => (
                      <QueryLogItem key={log.id} log={log} />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
