// Shared error handling utilities for all edge functions

export interface StandardError {
  error: string;
  details: string;
  userMessage: string;
  requestId: string;
  upstream?: {
    service: string;
    status: number;
  };
}

export interface RequestContext {
  requestId: string;
  endpoint: string;
  bbl?: string;
  startTime: number;
}

// Generate a unique request ID
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

// Create a request context for logging
export function createRequestContext(endpoint: string, bbl?: string): RequestContext {
  return {
    requestId: generateRequestId(),
    endpoint,
    bbl,
    startTime: Date.now(),
  };
}

// Log a request with context (never logs secrets)
export function logRequest(ctx: RequestContext, message: string, extra?: Record<string, unknown>) {
  const duration = Date.now() - ctx.startTime;
  const logData = {
    requestId: ctx.requestId,
    endpoint: ctx.endpoint,
    bbl: ctx.bbl,
    durationMs: duration,
    message,
    ...extra,
  };
  console.log(JSON.stringify(logData));
}

// Create a standardized error response
export function createErrorResponse(
  ctx: RequestContext,
  statusCode: number,
  error: string,
  details: string,
  userMessage: string,
  upstream?: { service: string; status: number },
  corsHeaders: Record<string, string> = {}
): Response {
  const errorBody: StandardError = {
    error,
    details,
    userMessage,
    requestId: ctx.requestId,
    ...(upstream && { upstream }),
  };

  logRequest(ctx, `Error: ${error}`, { statusCode, upstreamStatus: upstream?.status });

  return new Response(JSON.stringify(errorBody), {
    status: statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Create a success response with logging
export function createSuccessResponse(
  ctx: RequestContext,
  data: unknown,
  corsHeaders: Record<string, string> = {}
): Response {
  logRequest(ctx, 'Success');
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Rate limit error response
export function createRateLimitResponse(
  ctx: RequestContext,
  retryAfterSeconds: number,
  corsHeaders: Record<string, string> = {}
): Response {
  const errorBody: StandardError = {
    error: 'Rate limit exceeded',
    details: `Too many requests. Please wait ${retryAfterSeconds} seconds.`,
    userMessage: 'You\'re making too many requests. Please wait a moment and try again.',
    requestId: ctx.requestId,
  };

  logRequest(ctx, 'Rate limited', { retryAfter: retryAfterSeconds });

  return new Response(JSON.stringify(errorBody), {
    status: 429,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSeconds),
    },
  });
}

// Parse user-friendly messages for upstream errors
export function getUpstreamUserMessage(service: string, status: number): string {
  if (status === 429) {
    return `The ${service} service is temporarily overloaded. Please try again in a moment.`;
  }
  if (status >= 500) {
    return `The ${service} service is experiencing issues. Please try again later.`;
  }
  if (status === 404) {
    return 'No data found for the requested property.';
  }
  return `Unable to retrieve data from ${service}. Please try again.`;
}
