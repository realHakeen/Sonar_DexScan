import { env } from './env.js';

/** 搜索结果重排后向用户展示的候选数量上限（PRD F2：Top 3–5）。 */
export const CANDIDATE_LIMIT = 5;

/** 搜索接口单次拉取的原始条数上限（实测服务端封顶 100），重排在客户端完成。 */
export const SEARCH_FETCH_LIMIT = 100;

/** 卡片底部“同地址多链部署”提示中最多列出的次链数量。 */
export const SECONDARY_CHAIN_HINT_LIMIT = 3;

/** callback_data 令牌的存活时间；过期后按钮点击会提示重新扫描。 */
export const CALLBACK_TOKEN_TTL_MS = 30 * 60 * 1000;

/** 风控阈值集中在此，便于按产品策略统一调参。 */
export const RISK_THRESHOLDS = {
  top10Pct: env.RISK_TOP10_PCT,
  top50Pct: env.RISK_TOP50_PCT,
  singleLpPct: env.RISK_SINGLE_LP_PCT,
  minLiquidityUsd: env.RISK_MIN_LIQUIDITY_USD,
  maxTaxPct: env.RISK_MAX_TAX_PCT,
} as const;

/** F2 重排权重。数值本身不重要，重要的是量级差：流动性是第一权重。 */
export const RANKING_WEIGHTS = {
  liquidity: 1.0,
  volume24h: 0.55,
  hasCmcId: 0.9,
  traders24h: 0.35,
  officialContract: 3.0,
  exactSymbolMatch: 0.6,
  /** CMC 排名加成：前 100 / 前 1000 / 其余。 */
  cmcRankTop100: 1.2,
  cmcRankTop1000: 0.6,
  cmcRankListed: 0.3,
} as const;

/** 本地 CMC 收录索引的刷新间隔。 */
export const COIN_INDEX_REFRESH_MS = 60 * 60 * 1000;
/** 名称搜索时，从本地索引取前 N 条去 DEX 拉完整数据（每条 1 credit）。 */
export const COIN_INDEX_RESOLVE_LIMIT = 3;

export const PLACEHOLDER_TEXT = '🔍 Scanning…';
/** 渲染好的扫描卡按消息 id 缓存多久，供「◀ Back to report」零成本回填。 */
export const CARD_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * 永续合约数据的交易所白名单（2026-09-04 按 /v5/exchange/derivatives/list 实测圈定）。
 * 不能用 exchange_score 过滤：BTCC / Tapbit / Weex / Fameex 评分 7.7–8.8 却报出全网前几的假 OI；
 * 而 Hyperliquid 的 liquidity_score 是 0，edgeX / dYdX 没有评分。只能人工维护。
 * fundingIntervalH：CMC 原样透传各所费率不做归一，链上永续多为 1h 制，CEX 多为 8h 制。
 */
export interface PerpExchangeSpec {
  name: string;
  kind: 'cex' | 'dex';
  fundingIntervalH: number;
}
export const PERP_EXCHANGE_WHITELIST: Readonly<Record<string, PerpExchangeSpec>> = {
  binance: { name: 'Binance', kind: 'cex', fundingIntervalH: 8 },
  okx: { name: 'OKX', kind: 'cex', fundingIntervalH: 8 },
  bybit: { name: 'Bybit', kind: 'cex', fundingIntervalH: 8 },
  bitget: { name: 'Bitget', kind: 'cex', fundingIntervalH: 8 },
  gate: { name: 'Gate', kind: 'cex', fundingIntervalH: 8 },
  kucoin: { name: 'KuCoin', kind: 'cex', fundingIntervalH: 8 },
  mexc: { name: 'MEXC', kind: 'cex', fundingIntervalH: 8 },
  bingx: { name: 'BingX', kind: 'cex', fundingIntervalH: 8 },
  kraken: { name: 'Kraken', kind: 'cex', fundingIntervalH: 8 },
  'crypto-com-exchange': { name: 'Crypto.com', kind: 'cex', fundingIntervalH: 8 },
  htx: { name: 'HTX', kind: 'cex', fundingIntervalH: 8 },
  deribit: { name: 'Deribit', kind: 'cex', fundingIntervalH: 8 },
  hyperliquid: { name: 'Hyperliquid', kind: 'dex', fundingIntervalH: 1 },
  'aster-pro': { name: 'Aster', kind: 'dex', fundingIntervalH: 8 },
  lighter: { name: 'Lighter', kind: 'dex', fundingIntervalH: 1 },
  edgex: { name: 'edgeX', kind: 'dex', fundingIntervalH: 4 },
};

/** 白名单内兜底：某所 OI 超过同币白名单中位数的这个倍数即剔除（防单所单币抽风）。 */
export const PERP_OI_OUTLIER_MULTIPLIER = 20;
/** 卡片上列出的 OI 前 N 家交易所。 */
export const PERP_TOP_VENUES = 3;

/** CMC 帮助中心：供应量口径（流通 / 总量 / 最大）说明，卡片上 "circ." 链接到这里。 */
export const CMC_SUPPLY_METHODOLOGY_URL = 'https://support.coinmarketcap.com/hc/en-us/articles/360043396252-Supply-Circulating-Total-Max';
/** CMC 帮助中心：CMC Priority（CMCP）收录说明，"✅ CMC listed" 链接到这里。 */
export const CMC_LISTING_URL = 'https://support.coinmarketcap.com/hc/en-us/articles/16945563933723-CMC-Priority-CMCP';

/**
 * 现货成交量占比的交易所白名单（与 PERP_EXCHANGE_WHITELIST 同一思路）。
 * 按原始成交量排，PEPE 的第三到第五名是 WhiteBIT / UZX / Poloniex 这类刷量所，占比只在白名单内计算。
 */
export const SPOT_EXCHANGE_WHITELIST: Readonly<Record<string, string>> = {
  binance: 'Binance',
  'coinbase-exchange': 'Coinbase',
  okx: 'OKX',
  bybit: 'Bybit',
  upbit: 'Upbit',
  bitget: 'Bitget',
  gate: 'Gate',
  kucoin: 'KuCoin',
  mexc: 'MEXC',
  htx: 'HTX',
  kraken: 'Kraken',
  'crypto-com-exchange': 'Crypto.com',
  bithumb: 'Bithumb',
  bingx: 'BingX',
  bitstamp: 'Bitstamp',
  gemini: 'Gemini',
  bitfinex: 'Bitfinex',
  'hyperliquid-spot': 'Hyperliquid',
  hyperliquid: 'Hyperliquid',
  'binance-us': 'Binance US',
};
/** 卡片上列出的现货成交量前 N 家。 */
export const SPOT_TOP_VENUES = 3;
/** 现货交易对一次拉多少条（按成交量降序；1 credit / 100 条，前 100 已覆盖几乎全部有效成交量）。 */
export const SPOT_PAIRS_LIMIT = 100;

/** 每个用户 portfolio 最多存多少个代币（/portfolio 刷新时每个非 cid 代币 1 credit，封顶控制成本）。 */
export const PORTFOLIO_MAX_TOKENS = 20;

/** call 追踪的里程碑倍数，每群每币每档只播一次。 */
export const CALL_MILESTONES: readonly number[] = [2, 3, 5, 10, 20, 50, 100];
