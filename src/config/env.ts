import 'dotenv/config';
import { z } from 'zod';

const numeric = (def: number) =>
  z.coerce.number().int().nonnegative().default(def);

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, 'TELEGRAM_BOT_TOKEN is missing'),
  TELEGRAM_WEBHOOK_DOMAIN: z.string().optional().default(''),
  TELEGRAM_WEBHOOK_PATH: z.string().default('/tg/webhook'),
  PORT: numeric(3000),

  CMC_API_KEY: z.string().min(8, 'CMC_API_KEY is missing'),
  CMC_BASE_URL: z.string().url().default('https://pro-api.coinmarketcap.com'),
  CMC_TIMEOUT_MS: numeric(10_000),
  CMC_MAX_RETRIES: numeric(1),

  CACHE_TTL_SEARCH_MS: numeric(30_000),
  CACHE_TTL_QUOTE_MS: numeric(15_000),
  CACHE_TTL_HOLDERS_MS: numeric(120_000),
  CACHE_TTL_SECURITY_MS: numeric(600_000),
  CACHE_TTL_META_MS: numeric(3_600_000),
  CACHE_TTL_CHART_MS: numeric(300_000),
  /** 衍生品（OI / 费率 / 爆仓）缓存。上游每 60s 更新一次，缓存更短没有意义。 */
  CACHE_TTL_DERIVATIVES_MS: numeric(60_000),

  /** SQLite 数据目录（portfolio 等持久化）。Railway 上挂 Volume 到 /data 并设 DATA_DIR=/data；打不开时相关功能降级，不影响扫描。 */
  DATA_DIR: z.string().default('./data'),

  /** 图表 PNG 的公网地址前缀。缺省时从 Railway 的 RAILWAY_PUBLIC_DOMAIN 推导；都没有则不出图。 */
  PUBLIC_BASE_URL: z.string().optional().default(''),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional().default(''),

  RATE_LIMIT_PRIVATE_PER_MIN: numeric(20),
  RATE_LIMIT_GROUP_PER_MIN: numeric(6),
  RATE_LIMIT_GROUP_COOLDOWN_MS: numeric(3000),

  RISK_TOP10_PCT: z.coerce.number().default(60),
  RISK_TOP50_PCT: z.coerce.number().default(85),
  RISK_SINGLE_LP_PCT: z.coerce.number().default(70),
  RISK_MIN_LIQUIDITY_USD: z.coerce.number().default(5000),
  RISK_MAX_TAX_PCT: z.coerce.number().default(10),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed. Compare with .env.example:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = load();

export const isWebhookMode = Boolean(env.TELEGRAM_WEBHOOK_DOMAIN);

/** 对外可访问的 HTTP 根地址（无尾部斜杠），用于图表链接。 */
export const publicBaseUrl: string | undefined = env.PUBLIC_BASE_URL
  ? env.PUBLIC_BASE_URL.replace(/\/+$/, '')
  : env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
    : undefined;
