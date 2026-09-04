import { PERP_EXCHANGE_WHITELIST, PERP_OI_OUTLIER_MULTIPLIER, type PerpExchangeSpec } from '../config/constants.js';
import type { CmcDerivativePair, CmcLiquidationEntry } from '../api/cmc/types.js';
import type { LiquidationStats, PerpStats, PerpVenue } from './types.js';

/** 一年有多少个 8 小时结算周期。 */
const PERIODS_8H_PER_YEAR = 3 * 365;

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** 合约对是否可信：白名单内、CMC 未标离群、无被排除字段。 */
function trusted(pair: CmcDerivativePair, whitelist: Readonly<Record<string, PerpExchangeSpec>>): PerpExchangeSpec | undefined {
  const slug = pair.exchange?.exchange_slug;
  if (!slug) return undefined;
  const spec = whitelist[slug];
  if (!spec) return undefined;
  if (pair.outlier_detected) return undefined;
  if (Array.isArray(pair.exclusions) && pair.exclusions.length > 0) return undefined;
  return spec;
}

/**
 * 把 /v5 合约对列表压成卡片要的 PerpStats。纯函数，无 IO。
 * 规则（与产品讨论一致，2026-09-04）：
 *  1. 只统计白名单交易所，丢掉 outlier_detected / exclusions 非空的合约对；
 *  2. 同所多个合约对合并，费率取该所 OI 最大的那条；
 *  3. 兜底：最大所 OI 超过第二大所的 PERP_OI_OUTLIER_MULTIPLIER 倍即视为抽风剔除，循环直到收敛；
 *  4. 费率参考取 OI 最大且带费率的所，按各所结算周期折算到 8h，再简单年化。
 * 没有任何可信合约对时返回 undefined，卡片整段省略。
 */
export interface AggregateOptions {
  whitelist?: Readonly<Record<string, PerpExchangeSpec>>;
  outlierMultiplier?: number;
  /** 上游报告的总合约对数（可能大于本页返回的条数）。 */
  totalPairs?: number;
}

/** 永续基差超过这个绝对值就当脏数据（Kraken 的 XBT/USD 报过 +36%）。 */
const MAX_SANE_BASIS = 0.01;

export function aggregatePerpPairs(pairs: CmcDerivativePair[] | undefined, opts: AggregateOptions = {}): PerpStats | undefined {
  const whitelist = opts.whitelist ?? PERP_EXCHANGE_WHITELIST;
  const outlierMultiplier = opts.outlierMultiplier ?? PERP_OI_OUTLIER_MULTIPLIER;
  if (!pairs || pairs.length === 0) return undefined;

  const byVenue = new Map<string, PerpVenue & { fundingOi: number; pairs: number }>();
  for (const pair of pairs) {
    const spec = trusted(pair, whitelist);
    if (!spec) continue;
    const slug = pair.exchange!.exchange_slug!;
    const usd = pair.quotes?.find((q) => q.convert_symbol === 'USD') ?? pair.quotes?.[0];
    const oi = num(usd?.open_interest) ?? 0;
    const vol = num(usd?.volume_24h) ?? 0;
    if (oi < 0 || vol < 0) continue;
    const reported = pair.exchange_reported_quotes?.[0];
    const funding = num(reported?.funding_rate);
    const rawBasis = num(reported?.index_basis);
    const basis = rawBasis !== undefined && Math.abs(rawBasis) <= MAX_SANE_BASIS ? rawBasis : undefined;

    const cur = byVenue.get(slug) ?? {
      slug,
      name: spec.name,
      kind: spec.kind,
      openInterestUsd: 0,
      volume24hUsd: 0,
      fundingIntervalH: spec.fundingIntervalH,
      fundingRate: undefined,
      basis: undefined,
      fundingOi: -1,
      pairs: 0,
    };
    cur.openInterestUsd += oi;
    cur.volume24hUsd += vol;
    cur.pairs += 1;
    // 费率与基差都取该所 OI 最大的合约对
    if (oi > cur.fundingOi) {
      if (funding !== undefined) cur.fundingRate = funding;
      if (basis !== undefined) cur.basis = basis;
      if (funding !== undefined || basis !== undefined) cur.fundingOi = oi;
    }
    byVenue.set(slug, cur);
  }

  let kept = [...byVenue.values()]
    .filter((v) => v.openInterestUsd > 0 || v.volume24hUsd > 0)
    .sort((a, b) => b.openInterestUsd - a.openInterestUsd);

  // 兜底：白名单内单所单币抽风。只跟第二名比，不用中位数 —— 头部所合法地比中位数大几十倍是常态。
  while (kept.length >= 2 && kept[0]!.openInterestUsd > kept[1]!.openInterestUsd * outlierMultiplier && kept[1]!.openInterestUsd > 0) {
    kept = kept.slice(1);
  }
  if (kept.length === 0) return undefined;
  const countedPairs = kept.reduce((s, v) => s + v.pairs, 0);
  const venues: PerpVenue[] = kept.map(({ fundingOi: _a, pairs: _b, ...v }) => v);

  const openInterestUsd = venues.reduce((s, v) => s + v.openInterestUsd, 0);
  const volume24hUsd = venues.reduce((s, v) => s + v.volume24hUsd, 0);

  const fundingVenue = venues.find((v) => v.fundingRate !== undefined);
  const funding = fundingVenue
    ? normalizeFunding(fundingVenue.name, fundingVenue.fundingRate!, fundingVenue.fundingIntervalH)
    : undefined;

  return { openInterestUsd, volume24hUsd, venues, totalPairs: Math.max(opts.totalPairs ?? 0, pairs.length), countedPairs, funding };
}

/** 把「每 intervalH 小时的费率」折算成 8h 口径与简单年化。 */
export function normalizeFunding(venue: string, rate: number, intervalH: number): NonNullable<PerpStats['funding']> {
  const rate8h = rate * (8 / intervalH);
  return { venue, rate, intervalH, rate8h, apr: rate8h * PERIODS_8H_PER_YEAR };
}

/** liquidations 端点 → 域模型。取 USD quote；全为空返回 undefined。 */
export function toLiquidationStats(entry: CmcLiquidationEntry | undefined): LiquidationStats | undefined {
  const q = entry?.quotes?.find((x) => x.symbol === 'USD') ?? entry?.quotes?.[0];
  if (!q) return undefined;
  const out: LiquidationStats = {
    total1hUsd: num(q.total_liquidations_1h),
    long1hUsd: num(q.long_liquidations_1h),
    short1hUsd: num(q.short_liquidations_1h),
    total4hUsd: num(q.total_liquidations_4h),
    long4hUsd: num(q.long_liquidations_4h),
    short4hUsd: num(q.short_liquidations_4h),
    total24hUsd: num(q.total_liquidations_24h),
    long24hUsd: num(q.long_liquidations_24h),
    short24hUsd: num(q.short_liquidations_24h),
  };
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

/** /perp 的 symbol 消歧：第一名明显占优就直接用，否则让用户选。 */
export interface RankedCoin {
  cmcId: number;
  rank?: number;
}

/**
 * 同名币里第一名是否明显占优。规则：第二名没有排名，或排名落后第一名 5 倍以上，或差 500 名以上。
 * 有永续合约的币几乎都是排名靠前的那个，所以绝大多数情况一次命中。
 */
export function isDominantCoin<T extends RankedCoin>(hits: T[]): boolean {
  const [first, second] = hits;
  if (!first) return false;
  if (!second) return true;
  if (first.rank === undefined) return false;
  if (second.rank === undefined) return true;
  return second.rank >= first.rank * 5 || second.rank - first.rank >= 500;
}
