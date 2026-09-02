import { env } from '../../config/env.js';
import { NetworkError, TimeoutError, UpstreamError } from '../../infra/errors.js';
import { createLogger } from '../../infra/logger.js';
import { TtlCache } from '../../infra/cache.js';
import type { CmcEnvelope } from './types.js';

const log = createLogger('cmc');

export type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue>;

export type JsonBody = Record<string, unknown>;

export interface RequestOptions {
  /** 该次请求的缓存 TTL，0 表示不缓存。 */
  cacheTtlMs?: number;
  /**
   * 4xx 与业务错误码返回 null 而非抛错（"没有这个代币"是正常结果）。
   * 网络失败 / 超时 / 5xx 在重试耗尽后仍然抛出 —— 调用方需要区分"没有"和"没连上"。
   */
  softFail?: boolean;
  signal?: AbortSignal;
}

function buildUrl(baseUrl: string, path: string, query: Query): string {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function cacheKey(method: string, path: string, query: Query, body?: JsonBody): string {
  const entries = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const bodyKey = body ? JSON.stringify(body, Object.keys(body).sort()) : '';
  return `${method} ${path}?${entries.join('&')}#${bodyKey}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * CMC HTTP 客户端：鉴权、超时、指数退避重试、响应缓存、并发去重。
 * 只有它知道 API Key 的存在，上层永远拿不到密钥。
 */
export class CmcClient {
  private readonly cache = new TtlCache<unknown>(env.CACHE_TTL_QUOTE_MS, 8000);

  constructor(
    private readonly apiKey = env.CMC_API_KEY,
    private readonly baseUrl = env.CMC_BASE_URL,
    private readonly timeoutMs = env.CMC_TIMEOUT_MS,
    private readonly maxRetries = env.CMC_MAX_RETRIES,
  ) {}

  async get<T>(path: string, query: Query = {}, opts: RequestOptions = {}): Promise<T | null> {
    return this.request<T>('GET', path, query, undefined, opts);
  }

  /** v1 dex holders 系端点是 POST + JSON body。 */
  async post<T>(path: string, body: JsonBody, opts: RequestOptions = {}): Promise<T | null> {
    return this.request<T>('POST', path, {}, body, opts);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    query: Query,
    body: JsonBody | undefined,
    opts: RequestOptions,
  ): Promise<T | null> {
    const ttl = opts.cacheTtlMs ?? 0;
    const key = cacheKey(method, path, query, body);

    const run = () => this.execute<T>(method, path, query, body, opts);
    if (ttl <= 0) return run();
    return this.cache.wrap(key, run as () => Promise<unknown>, ttl) as Promise<T | null>;
  }

  private async execute<T>(
    method: 'GET' | 'POST',
    path: string,
    query: Query,
    body: JsonBody | undefined,
    opts: RequestOptions,
  ): Promise<T | null> {
    const url = buildUrl(this.baseUrl, path, query);
    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const onAbort = () => controller.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      const startedAt = Date.now();
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'X-CMC_PRO_API_KEY': this.apiKey,
            Accept: 'application/json',
            'Accept-Encoding': 'deflate, gzip',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        const elapsed = Date.now() - startedAt;

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          // 4xx 通常是参数问题，重试没有意义，直接结束
          if (res.status < 500 && res.status !== 429) {
            if (opts.softFail) {
              log.debug('softFail: ignoring 4xx', { path, status: res.status });
              return null;
            }
            throw new UpstreamError(res.status, path, body.slice(0, 300));
          }
          lastErr = new UpstreamError(res.status, path, body.slice(0, 300));
          if (attempt < this.maxRetries) {
            await sleep(this.backoff(attempt, res.headers.get('retry-after')));
            continue;
          }
          throw lastErr;
        }

        const json = (await res.json()) as CmcEnvelope<T> | T;
        const envelope = json as CmcEnvelope<T>;
        log.debug('request done', { path, elapsed, credits: envelope.status?.credit_count });

        // 实测 error_code 是字符串（成功 "0"，失败 "400"），必须转数值再比较
        const errorCode = Number(envelope.status?.error_code ?? 0);
        if (Number.isFinite(errorCode) && errorCode !== 0) {
          if (opts.softFail) {
            log.warn('upstream returned an error code', { path, errorCode, msg: envelope.status?.error_message });
            return null;
          }
          throw new UpstreamError(200, path, envelope.status?.error_message ?? 'unknown error');
        }
        // 主 API 与 v4 dex 包在 {data, status} 里；v1 dex（如 /v1/dex/search 返回 {total, tks}）不包
        const hasEnvelope = json !== null && typeof json === 'object' && 'data' in (json as object);
        return (hasEnvelope ? envelope.data ?? null : (json as T)) as T | null;
      } catch (err) {
        if (err instanceof UpstreamError) throw err;
        if (controller.signal.aborted && !opts.signal?.aborted) {
          lastErr = new TimeoutError(path, this.timeoutMs);
        } else {
          lastErr = err;
        }
        if (attempt < this.maxRetries) {
          log.debug('request failed, retrying', { path, attempt, err: String(lastErr) });
          await sleep(this.backoff(attempt, null));
          continue;
        }
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }

    // 走到这里一定是网络 / 超时 / 5xx 重试耗尽，softFail 也不吞：上层要知道是"没连上"
    if (lastErr instanceof UpstreamError || lastErr instanceof TimeoutError) throw lastErr;
    const cause = (lastErr as { cause?: { code?: string; message?: string } })?.cause;
    log.warn('network-level failure', { path, err: String(lastErr), code: cause?.code, causeMsg: cause?.message });
    throw new NetworkError(path, lastErr);
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    const header = retryAfter ? Number(retryAfter) * 1000 : NaN;
    if (Number.isFinite(header) && header > 0) return Math.min(header, 5000);
    const base = 250 * 2 ** attempt;
    return base + Math.random() * 150;
  }
}
