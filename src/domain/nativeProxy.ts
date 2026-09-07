import type { CoinIndex, CoinIndexHit } from './coinIndex.js';
import { looksLikeAddress } from './detectChain.js';
import type { TokenCandidate } from './types.js';

/**
 * 原生币（NEAR / TAO / AVAX / HYPE / ETH…）在 CMC map 里没有可扫的合约地址：platform 为空，
 * 或 token_address 不是地址（Bittensor 的 "0"、Hyperliquid 的 32 位资产 id "0x0d01dc…"）。
 * 本地索引默认跳过它们，DEX search 又只认识封装 / 桥接代币，于是 $NEAR 出来的是 "Wrapped NEAR"、$HYPE 是 WHYPE。
 */
export function isNativeCoin(hit: CoinIndexHit): boolean {
  return !hit.address || !looksLikeAddress(hit.address);
}

/** 封装代币自己在 CMC 的排名超过这个数（或没排名）才当作原生币的影子；WBTC 排在前 20，是独立资产，不代理。 */
const WRAPPED_OWN_RANK_MIN = 1000;

/**
 * 候选是不是原生币在链上的代表：
 *  - CMC 直接把它挂在原生币 cid 下（Solana 上的桥接 TAO cid=22974、DexScan 的原生 AVAX 占位地址 cid=5805），或
 *  - W + symbol、名字带 Wrapped、且自己没有像样的 CMC 排名
 *    （WNEAR "Wrapped NEAR fungible token" / WTAO #8045 / WAVAX #8023 / WETH / WBNB / WSOL；WBTC #15 不算）。
 */
export function representsNative(c: TokenCandidate, native: CoinIndexHit, index?: CoinIndex): boolean {
  // 注意只在 $ticker 搜索精确命中原生币时才用；直接贴 WBTC / wrap.near 地址就是看封装币本身，不代理

  if (c.cmcId !== undefined && c.cmcId === native.cmcId) return true;
  return c.symbol.toUpperCase() === `W${native.symbol}` && /\bwrapped\b/i.test(c.name) && !hasOwnStanding(c, index);
}

/**
 * 封装代币自己是不是一个有排名的独立资产。按地址扫时候选还没过 markOfficialContracts（cmcRank 为空），
 * 所以有索引就直接按合约 / cid 查它自己的收录记录。
 */
function hasOwnStanding(c: TokenCandidate, index?: CoinIndex): boolean {
  const own = index?.isLoaded ? (index.byContract(c.address) ?? (c.cmcId !== undefined ? index.byCmcId(c.cmcId) : undefined)) : undefined;
  const rank = own?.rank ?? c.cmcRank;
  return rank !== undefined && rank <= WRAPPED_OWN_RANK_MIN;
}

/**
 * 给链上代表挂上币层：cid / 排名 / ✅ 按原生币（主 API 行情、现货、合约都靠 cid），
 * symbol / name / 地址 / 池子 / 成交 / 持有人保持封装代币本身，卡片两层都显示。
 * 封装代币自己的收录市值 / 流通量 / 上所列表不是原生币的，去掉，免得当兜底用。
 */
export function attachCoin(rep: TokenCandidate, native: CoinIndexHit): TokenCandidate {
  return {
    ...rep,
    cmcId: native.cmcId,
    cmcRank: native.rank,
    officialVerified: true,
    coin: { cmcId: native.cmcId, symbol: native.symbol, name: native.name, rank: native.rank },
    listingMarketCapUsd: undefined,
    circulatingSupply: undefined,
    cexListings: undefined,
  };
}

/**
 * 查询词精确命中一个原生币时，从 DEX 候选里挑流动性最高的代表挂上币层（其余不动）。
 * 找不到代表返回 undefined，走普通流程。
 */
export function proxyNativeCoin(pool: TokenCandidate[], native: CoinIndexHit, index?: CoinIndex): { pool: TokenCandidate[]; proxy: TokenCandidate } | undefined {
  const reps = pool.filter((c) => representsNative(c, native, index));
  if (reps.length === 0) return undefined;
  const rep = reps.reduce((a, b) => ((b.liquidityUsd ?? 0) > (a.liquidityUsd ?? 0) ? b : a));
  const proxy = attachCoin(rep, native);
  return { pool: pool.map((c) => (c === rep ? proxy : c)), proxy };
}
