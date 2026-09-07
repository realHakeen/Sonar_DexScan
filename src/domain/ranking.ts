import { RANKING_WEIGHTS } from '../config/constants.js';
import type { TokenCandidate } from './types.js';

export interface ScoredCandidate {
  candidate: TokenCandidate;
  score: number;
  /** 评分明细，便于调参和排障。 */
  breakdown: Record<string, number>;
}

/** 用对数压缩量级差，否则单个巨额流动性会吃掉其他所有维度。 */
function logScale(v: number | undefined): number {
  if (!v || v <= 0) return 0;
  return Math.log10(v + 1);
}

/**
 * PRD F2 重排。服务端按文本相关性排序不可直接使用：
 * 搜 "PEPE" 时所有仿盘相关性几乎相同，真正有流动性的可能排在第 30 位。
 * 权重顺序：流动性 > 成交量 > 是否有 cid > 交易人数。
 */
export interface ScoreContext {
  /** 候选集里是否存在 symbol 与查询词完全一致的候选（rankCandidates 算好传进来）。 */
  exactSymbolExists?: boolean;
}

export function scoreCandidate(c: TokenCandidate, query: string, ctx: ScoreContext = {}): ScoredCandidate {
  const w = RANKING_WEIGHTS;
  const breakdown: Record<string, number> = {};

  breakdown['liquidity'] = logScale(c.liquidityUsd) * w.liquidity;
  breakdown['volume24h'] = logScale(c.volume24hUsd) * w.volume24h;
  breakdown['cmcListed'] = c.cmcId ? w.hasCmcId : 0;
  breakdown['traders24h'] = logScale(c.traders24h) * w.traders24h;
  breakdown['official'] = c.officialVerified ? w.officialContract : 0;
  breakdown['cmcRank'] =
    c.cmcRank === undefined ? 0 : c.cmcRank <= 100 ? w.cmcRankTop100 : c.cmcRank <= 1000 ? w.cmcRankTop1000 : w.cmcRankListed;

  const q = query.trim().toUpperCase();
  const exact = c.symbol.toUpperCase() === q;
  breakdown['exactSymbol'] = exact ? w.exactSymbolMatch : 0;
  // $AGI：Delysium（CMC #816）DEX 池只有 $10K，光靠流动性打分会被 AGIX（$250K）挤掉，甚至进不了前 5。
  // 用户打的就是这个 ticker、CMC 认定这个 ticker 的正版就是它 → 强加成；反过来 symbol 不一致的前缀匹配扣分。
  if (exact && c.officialVerified && c.cmcRank !== undefined && c.cmcRank <= 1000) breakdown['listedTicker'] = w.listedTicker;
  if (!exact && ctx.exactSymbolExists) breakdown['symbolMismatch'] = -w.symbolMismatch;

  // 刷量惩罚：成交量高但交易人数极少
  const vol = c.volume24hUsd ?? 0;
  const traders = c.traders24h ?? 0;
  if (vol > 50_000 && traders > 0 && vol / traders > 50_000) {
    breakdown['washTradePenalty'] = -1.2;
  } else if (vol > 50_000 && traders === 0) {
    breakdown['washTradePenalty'] = -0.8;
  }

  // 空池惩罚：仿盘基本都是空池
  if ((c.liquidityUsd ?? 0) < 1000) breakdown['emptyPoolPenalty'] = -1.5;

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { candidate: c, score, breakdown };
}

/** 重排并去重（同链同地址只保留流动性最高的一条）。 */
export function rankCandidates(
  candidates: TokenCandidate[],
  query: string,
  limit?: number,
): ScoredCandidate[] {
  const deduped = new Map<string, TokenCandidate>();
  for (const c of candidates) {
    const key = `${c.networkSlug}:${c.address.toLowerCase()}`;
    const prev = deduped.get(key);
    if (!prev || (c.liquidityUsd ?? 0) > (prev.liquidityUsd ?? 0)) {
      deduped.set(key, c);
    }
  }

  const q = query.trim().toUpperCase();
  const ctx: ScoreContext = { exactSymbolExists: [...deduped.values()].some((c) => c.symbol.toUpperCase() === q) };
  // ticker 精确匹配是硬性第一档：$AGI 里所有 symbol=AGI 的候选永远排在 AGIX / AGIALPHA 前面，
  // 不管后者流动性多大（其他 bot 出 AGIX 就是只按流动性排）。层内再按分数。
  const scored = [...deduped.values()]
    .map((c) => scoreCandidate(c, query, ctx))
    .sort((a, b) => tier(b, q) - tier(a, q) || b.score - a.score);

  return limit === undefined ? scored : scored.slice(0, limit);
}

function tier(s: ScoredCandidate, q: string): number {
  return s.candidate.symbol.toUpperCase() === q ? 1 : 0;
}

/**
 * PRD F1 第 3 步：同一个地址命中多条链时，按流动性降序取第一个为主链。
 * 次要链结果不丢弃，作为「多链部署」提示返回。
 */
export function splitByChain(candidates: TokenCandidate[]): {
  primary?: TokenCandidate;
  secondary: TokenCandidate[];
} {
  const sorted = [...candidates].sort(
    (a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0),
  );
  const [primary, ...secondary] = sorted;
  return { primary, secondary };
}
