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
