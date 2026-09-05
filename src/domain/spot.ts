import { SPOT_EXCHANGE_WHITELIST } from '../config/constants.js';
import type { CmcMarketPair } from '../api/cmc/types.js';
import type { SpotStats, SpotVenue } from './types.js';

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 现货交易对 → 按交易所的成交量占比。纯函数。
 * 只统计白名单交易所，丢掉 outlier_detected / exclusions 非空的对；同所多对合并。
 * 一对可信数据都没有时返回 undefined，卡片省略 Top 行。
 */
export function aggregateSpotPairs(
  pairs: CmcMarketPair[] | undefined,
  limit: number,
  whitelist: Readonly<Record<string, string>> = SPOT_EXCHANGE_WHITELIST,
): SpotStats | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  const byVenue = new Map<string, SpotVenue>();
  for (const pair of pairs) {
    const slug = pair.exchange?.slug;
    if (!slug || !whitelist[slug]) continue;
    if (pair.outlier_detected) continue;
    if (Array.isArray(pair.exclusions) && pair.exclusions.length > 0) continue;
    const usd = pair.quote?.['USD'] ?? Object.values(pair.quote ?? {})[0];
    const vol = num(usd?.volume_24h) ?? 0;
    if (vol <= 0) continue;
    const cur = byVenue.get(slug) ?? { slug, name: whitelist[slug]!, volume24hUsd: 0 };
    cur.volume24hUsd += vol;
    byVenue.set(slug, cur);
  }
  const venues = [...byVenue.values()].sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  if (venues.length === 0) return undefined;
  return {
    venues,
    whitelistVolumeUsd: venues.reduce((s, v) => s + v.volume24hUsd, 0),
    returnedPairs: pairs.length,
    complete: pairs.length < limit,
  };
}
