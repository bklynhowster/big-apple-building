// Retry logic for upstream API calls (NYC Open Data, Geoclient)

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
  retryAfter?: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 1,
  baseDelayMs: 250,
  maxDelayMs: 2000,
};

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse Retry-After header
function parseRetryAfter(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return null;
  
  // Could be seconds or a date
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) return seconds;
  
  // Try parsing as date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
  }
  
  return null;
}

// Fetch with retry for 5xx errors only
// 429s are NOT retried - we respect rate limits
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: Partial<RetryOptions> = {}
): Promise<FetchResult> {
  const opts = { ...DEFAULT_OPTIONS, ...retryOptions };
  let lastError: string | undefined;
  let lastStatus = 0;
  
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      lastStatus = response.status;
      
      // Success
      if (response.ok) {
        const data = await response.json();
        return { ok: true, status: response.status, data };
      }
      
      // 429 - Rate limited, do NOT retry
      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers);
        const errorText = await response.text().catch(() => 'Rate limit exceeded');
        return {
          ok: false,
          status: 429,
          error: errorText,
          retryAfter: retryAfter ?? 60,
        };
      }
      
      // 5xx - Server error, retry with backoff
      if (response.status >= 500 && attempt < opts.maxRetries) {
        const delay = Math.min(
          opts.baseDelayMs * Math.pow(2, attempt),
          opts.maxDelayMs
        );
        console.log(`Upstream ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1})`);
        await sleep(delay);
        continue;
      }
      
      // 4xx or final 5xx - return error
      const errorText = await response.text().catch(() => 'Unknown error');
      return { ok: false, status: response.status, error: errorText };
      
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      
      // Network errors - retry with backoff
      if (attempt < opts.maxRetries) {
        const delay = Math.min(
          opts.baseDelayMs * Math.pow(2, attempt),
          opts.maxDelayMs
        );
        console.log(`Network error, retrying in ${delay}ms: ${lastError}`);
        await sleep(delay);
        continue;
      }
    }
  }
  
  return {
    ok: false,
    status: lastStatus || 0,
    error: lastError || 'All retry attempts failed',
  };
}
