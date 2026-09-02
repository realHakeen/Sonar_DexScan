/** 所有可预期的业务错误都继承它，便于中间件统一转成用户可读文案。 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class UpstreamError extends AppError {
  constructor(
    readonly status: number,
    readonly endpoint: string,
    message: string,
    cause?: unknown,
  ) {
    super(
      `CMC ${endpoint} -> HTTP ${status}: ${message}`,
      status === 429
        ? '⏳ Upstream rate limit hit. Please try again shortly.'
        : status >= 500
          ? '🛠 Data source is temporarily unavailable. Please try again later.'
          : '⚠️ Data source returned an unexpected response. Please try again later.',
      cause,
    );
  }
}

export class NetworkError extends AppError {
  constructor(endpoint: string, cause: unknown) {
    const code = (cause as { cause?: { code?: string } })?.cause?.code ?? (cause as { code?: string })?.code;
    super(
      `CMC ${endpoint} network failure${code ? ` (${code})` : ''}: ${String(cause)}`,
      '🌐 Could not reach the data source. Check your network or proxy and try again.',
      cause,
    );
  }
}

export class TimeoutError extends AppError {
  constructor(endpoint: string, ms: number) {
    super(`CMC ${endpoint} timed out after ${ms}ms`, '⌛️ Data source timed out. Please try again.');
  }
}

export class NotFoundError extends AppError {
  constructor(query: string) {
    super(
      `No matching token: ${query}`,
      '🤷 Token not found. Double-check the contract address, or try a different name / ticker.',
    );
  }
}

export class InvalidInputError extends AppError {
  constructor(reason: string) {
    super(`Invalid input: ${reason}`, '⚠️ I could not understand that. Send a contract address, a token name, or a DexScreener / DexScan link.');
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterMs: number) {
    super(
      `Local rate limit, retry in ${retryAfterMs}ms`,
      `🚦 Too many requests. Please wait ${Math.ceil(retryAfterMs / 1000)}s and try again.`,
    );
  }
}

export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.userMessage;
  return '❌ Something went wrong. Please try again later.';
}
