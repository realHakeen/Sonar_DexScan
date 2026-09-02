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

  RATE_LIMIT_PRIVATE_PER_MIN: numeric(20),
  RATE_LIMIT_GROUP_PER_MIN: numeric(6),
  RATE_LIMIT_GROUP_COOLDOWN_MS: numeric(8000),

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
