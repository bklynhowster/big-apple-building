// Standardized API error types for frontend

export interface ApiError {
  error: string;
  details: string;
  userMessage: string;
  requestId: string;
  upstream?: {
    service: string;
    status: number;
  };
}

// Type guard to check if an error response matches our standard format
export function isApiError(data: unknown): data is ApiError {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.error === 'string' &&
    typeof obj.requestId === 'string'
  );
}

// Parse error from response, with fallback for non-standard errors
export async function parseApiError(response: Response): Promise<ApiError> {
  try {
    const data = await response.json();
    if (isApiError(data)) {
      return data;
    }
    // Non-standard error format
    return {
      error: data.error || `HTTP ${response.status}`,
      details: data.details || data.message || '',
      userMessage: data.userMessage || 'An unexpected error occurred. Please try again.',
      requestId: data.requestId || 'unknown',
    };
  } catch {
    return {
      error: `HTTP ${response.status}`,
      details: response.statusText,
      userMessage: 'An unexpected error occurred. Please try again.',
      requestId: 'unknown',
    };
  }
}

// User-friendly error messages based on status codes
export function getErrorMessage(status: number, error?: ApiError): string {
  if (error?.userMessage) {
    return error.userMessage;
  }
  
  switch (status) {
    case 400:
      return 'Invalid request. Please check your input and try again.';
    case 401:
    case 403:
      return 'Authentication error. Please refresh the page and try again.';
    case 404:
      return 'No data found for the requested property.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 502:
    case 503:
    case 504:
      return 'The data service is temporarily unavailable. Please try again later.';
    default:
      if (status >= 500) {
        return 'A server error occurred. Please try again later.';
      }
      return 'An unexpected error occurred. Please try again.';
  }
}
