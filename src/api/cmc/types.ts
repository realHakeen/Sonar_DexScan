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
      /** 24h 成交量相对前一日的变化（百分比）。 */
      volume_change_24h?: number | null;
      /** 现货成交量的 CEX / DEX 拆分，CMC 已汇总。 */
      cex_volume_24h?: number | null;
      dex_volume_24h?: number | null;
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

/** /v5/cryptocurrency/derivatives/market-pairs 的单条合约对（字段名以 2026-09-04 实测为准）。 */
export interface CmcDerivativePair {
  market_id?: number;
  market_pair_symbol?: string;
  /** 实测全部为 'perpetual'。 */
  category?: string;
  outlier_detected?: boolean;
  exclusions?: string[] | null;
  exchange?: { exchange_id?: number; exchange_name?: string; exchange_slug?: string };
  market_pair_base?: { crypto_id?: number; symbol?: string; exchange_symbol?: string };
  market_pair_quote?: { crypto_id?: number; symbol?: string; exchange_symbol?: string };
  exchange_reported_quotes?: Array<{
    convert_symbol?: string;
    price?: number | null;
    volume_24h_quote?: number | null;
    open_interest?: number | null;
    index_price?: number | null;
    index_basis?: number | null;
    /** 每个结算周期的费率（小数，如 0.0001 = 0.01%），周期因交易所而异。 */
    funding_rate?: number | null;
    last_updated?: string;
  }>;
  quotes?: Array<{
    convert_symbol?: string;
    price?: number | null;
    volume_24h?: number | null;
    open_interest?: number | null;
    last_updated?: string;
  }>;
}

export interface CmcDerivativePairsResponse {
  crypto_id?: number;
  symbol?: string;
  num_market_pairs?: number;
  market_pairs?: CmcDerivativePair[];
}

/** /v5/derivatives/liquidations/cryptocurrency 的单币条目。金额 USD。 */
export interface CmcLiquidationEntry {
  crypto_id?: number;
  symbol?: string;
  cmc_rank?: number;
  quotes?: Array<{
    symbol?: string;
    total_liquidations_1h?: number | null;
    long_liquidations_1h?: number | null;
    short_liquidations_1h?: number | null;
    total_liquidations_4h?: number | null;
    long_liquidations_4h?: number | null;
    short_liquidations_4h?: number | null;
    total_liquidations_24h?: number | null;
    long_liquidations_24h?: number | null;
    short_liquidations_24h?: number | null;
    last_updated?: string;
  }>;
}

/** /v2/cryptocurrency/market-pairs/latest 的单条现货交易对。 */
export interface CmcMarketPair {
  market_id?: number;
  market_pair?: string;
  category?: string;
  outlier_detected?: boolean | number;
  exclusions?: Array<string | { reason?: string }> | null;
  exchange?: { id?: number; name?: string; slug?: string };
  quote?: Record<string, { price?: number | null; volume_24h?: number | null }>;
}

export interface CmcMarketPairsResponse {
  id?: number;
  num_market_pairs?: number;
  market_pairs?: CmcMarketPair[];
}
