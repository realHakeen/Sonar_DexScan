import { env } from '../../config/env.js';
import type { CoreMarketData } from '../../domain/types.js';
import type { CmcClient } from './client.js';
import { ENDPOINTS } from './endpoints.js';
import type { CmcInfoEntry, CmcMapEntry, CmcQuoteEntry } from './types.js';

/**
 * 主 API（非 DEX）门面。核心优势就来自这里：
 * 通过 cid 打通 CEX 侧数据，给出竞品拿不到的真实流通市值、CMC 排名、赛道分类。
 */
export class CoreApi {
  constructor(private readonly client: CmcClient) {}

  /** 正版识别：按 symbol 取 CMC 官方收录的合约地址。 */
  async officialContracts(symbol: string): Promise<CmcMapEntry[]> {
    const data = await this.client.get<CmcMapEntry[]>(
      ENDPOINTS.core.map,
      { symbol: symbol.toUpperCase(), listing_status: 'active', aux: 'platform', limit: 20 },
      { cacheTtlMs: env.CACHE_TTL_META_MS, softFail: true },
    );
    return data ?? [];
  }

  /**
   * 全量收录列表（listing_status=active，实测 ~8k 条、0 credits）。分页拉取，供 CoinIndex 建本地索引。
   * 注意：这个端点的 slug 过滤在部分 Key 上不生效并返回全量，所以永远不要在请求路径里按 slug 查。
   */
  async fullMap(): Promise<CmcMapEntry[]> {
    const pageSize = 5000;
    const all: CmcMapEntry[] = [];
    for (let start = 1; start < 50_000; start += pageSize) {
      const page = await this.client.get<CmcMapEntry[]>(
        ENDPOINTS.core.map,
        { listing_status: 'active', aux: 'platform', start, limit: pageSize, sort: 'cmc_rank' },
        { cacheTtlMs: 0, softFail: false },
      );
      if (!page || page.length === 0) break;
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  }

  /** 真实流通市值 + CMC 排名 + 赛道分类。 */
  async marketData(cmcId: number): Promise<CoreMarketData | undefined> {
    const data = await this.client.get<Record<string, CmcQuoteEntry>>(
      ENDPOINTS.core.quotes,
      { id: cmcId, convert: 'USD' },
      { cacheTtlMs: env.CACHE_TTL_QUOTE_MS, softFail: true },
    );
    const entry = data?.[String(cmcId)];
    if (!entry) return undefined;

    const usd = entry.quote?.['USD'];
    return {
      cmcId,
      cmcRank: entry.cmc_rank ?? undefined,
      marketCapUsd: usd?.market_cap ?? undefined,
      fdvUsd: usd?.fully_diluted_market_cap ?? undefined,
      circulatingSupply: entry.circulating_supply ?? undefined,
      totalSupply: entry.total_supply ?? undefined,
      categories: normalizeTags(entry.tags),
      numMarketPairs: (entry as { num_market_pairs?: number }).num_market_pairs,
    };
  }

  /** 赛道分类与官方链接的兜底来源（quotes 未带 tags 时使用）。 */
  async info(cmcId: number): Promise<CmcInfoEntry | undefined> {
    const data = await this.client.get<Record<string, CmcInfoEntry>>(
      ENDPOINTS.core.info,
      { id: cmcId, aux: 'urls,logo,tags,platform,category' },
      { cacheTtlMs: env.CACHE_TTL_META_MS, softFail: true },
    );
    return data?.[String(cmcId)];
  }
}

function normalizeTags(tags: CmcQuoteEntry['tags']): string[] {
  if (!tags) return [];
  return tags
    .map((t) => (typeof t === 'string' ? t : (t.name ?? t.slug ?? '')))
    .filter((t): t is string => Boolean(t))
    .slice(0, 6);
}
