/** CMC 统一响应信封。 */
export interface CmcEnvelope<T> {
  data: T;
  status?: {
    timestamp?: string;
    error_code?: number;
    error_message?: string | null;
    elapsed?: number;
    credit_count?: number;
  };
}

/**
 * DEX 相关端点的原始记录一律按宽松结构处理。
 * 原因：dex 端点在不同路径下会返回短字段（n/s/liq/pu…）或长字段
 * （name/symbol/liquidity…），且随版本演进。字段读取统一走 mappers.ts，
 * 这里不做强约束，避免上游加字段就把整个流程打挂。
 */
export type RawRecord = Record<string, unknown>;

export interface CmcMapEntry {
  id: number;
  name: string;
  symbol: string;
  slug?: string;
  rank?: number;
  is_active?: number;
  platform?: {
    id?: number;
    name?: string;
    symbol?: string;
    slug?: string;
    token_address?: string;
  } | null;
}

export interface CmcQuoteEntry {
  id: number;
  name: string;
  symbol: string;
  slug?: string;
  cmc_rank?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
  tags?: Array<string | { slug?: string; name?: string; category?: string }>;
  quote?: Record<
    string,
    {
      price?: number | null;
      volume_24h?: number | null;
      percent_change_24h?: number | null;
      market_cap?: number | null;
      fully_diluted_market_cap?: number | null;
      last_updated?: string;
    }
  >;
}

export interface CmcInfoEntry {
  id: number;
  name: string;
  symbol: string;
  category?: string;
  description?: string;
  logo?: string;
  tags?: string[];
  'tag-names'?: string[];
  urls?: Record<string, string[]>;
  platform?: { name?: string; token_address?: string } | null;
}
