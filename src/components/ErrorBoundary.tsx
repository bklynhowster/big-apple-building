import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  handleRefresh = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <Card className="max-w-lg w-full">
            <CardContent className="flex flex-col items-center text-center py-12">
              <div className="rounded-full bg-destructive/10 p-4 mb-6">
                <AlertTriangle className="h-12 w-12 text-destructive" />
              </div>
              
              <h1 className="text-2xl font-semibold text-foreground mb-2">
                Something went wrong
              </h1>
              
              <p className="text-muted-foreground mb-6 max-w-sm">
                An unexpected error occurred. Our team has been notified.
                Please try refreshing the page or return to the home page.
              </p>

              {this.state.error && (
                <div className="w-full mb-6 p-3 rounded-md bg-muted text-left overflow-hidden">
                  <p className="text-xs font-mono text-muted-foreground break-all">
                    {this.state.error.message || 'Unknown error'}
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <Button 
                  onClick={this.handleRefresh}
                  variant="outline"
                  className="gap-2"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh Page
                </Button>
                <Button 
                  onClick={this.handleGoHome}
                  className="gap-2"
                >
                  <Home className="h-4 w-4" />
                  Return to Search
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook-friendly wrapper for functional components
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
): React.FC<P> {
  return function WrappedComponent(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
