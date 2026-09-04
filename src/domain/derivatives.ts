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
export function aggregatePerpPairs(
  pairs: CmcDerivativePair[] | undefined,
  whitelist: Readonly<Record<string, PerpExchangeSpec>> = PERP_EXCHANGE_WHITELIST,
  outlierMultiplier = PERP_OI_OUTLIER_MULTIPLIER,
): PerpStats | undefined {
  if (!pairs || pairs.length === 0) return undefined;

  const byVenue = new Map<string, PerpVenue & { fundingOi: number }>();
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

    const cur = byVenue.get(slug) ?? {
      slug,
      name: spec.name,
      kind: spec.kind,
      openInterestUsd: 0,
      volume24hUsd: 0,
      fundingIntervalH: spec.fundingIntervalH,
      fundingRate: undefined,
      fundingOi: -1,
    };
    cur.openInterestUsd += oi;
    cur.volume24hUsd += vol;
    if (funding !== undefined && oi > cur.fundingOi) {
      cur.fundingRate = funding;
      cur.fundingOi = oi;
    }
    byVenue.set(slug, cur);
  }

  let venues: PerpVenue[] = [...byVenue.values()]
    .filter((v) => v.openInterestUsd > 0 || v.volume24hUsd > 0)
    .map(({ fundingOi: _drop, ...v }) => v)
    .sort((a, b) => b.openInterestUsd - a.openInterestUsd);

  // 兜底：白名单内单所单币抽风。只跟第二名比，不用中位数 —— 头部所合法地比中位数大几十倍是常态。
  while (venues.length >= 2 && venues[0]!.openInterestUsd > venues[1]!.openInterestUsd * outlierMultiplier && venues[1]!.openInterestUsd > 0) {
    venues = venues.slice(1);
  }
  if (venues.length === 0) return undefined;

  const openInterestUsd = venues.reduce((s, v) => s + v.openInterestUsd, 0);
  const volume24hUsd = venues.reduce((s, v) => s + v.volume24hUsd, 0);

  const fundingVenue = venues.find((v) => v.fundingRate !== undefined);
  const funding = fundingVenue
    ? normalizeFunding(fundingVenue.name, fundingVenue.fundingRate!, fundingVenue.fundingIntervalH)
    : undefined;

  return { openInterestUsd, volume24hUsd, venues, totalPairs: pairs.length, funding };
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
