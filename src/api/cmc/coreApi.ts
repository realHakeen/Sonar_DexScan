import { SPOT_PAIRS_LIMIT } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { aggregatePerpPairs, toLiquidationStats } from '../../domain/derivatives.js';
import { aggregateSpotPairs } from '../../domain/spot.js';
import type { CoreMarketData, LiquidationStats, PerpStats, SpotStats } from '../../domain/types.js';
import type { CmcClient } from './client.js';
import { ENDPOINTS } from './endpoints.js';
import type {
  CmcDerivativePairsResponse,
  CmcInfoEntry,
  CmcLiquidationEntry,
  CmcMapEntry,
  CmcMarketPairsResponse,
  CmcQuoteEntry,
} from './types.js';

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
      spotVolume24hUsd: usd?.volume_24h ?? undefined,
      volumeChange24hPct: usd?.volume_change_24h ?? undefined,
      priceUsd: usd?.price ?? undefined,
      cexVolume24hUsd: usd?.cex_volume_24h ?? undefined,
      dexVolume24hUsd: usd?.dex_volume_24h ?? undefined,
    };
  }

  /**
   * 永续合约视角：OI / 合约成交量 / 费率。1 credit，白名单聚合在 domain/derivatives.ts。
   * 该币没有任何永续合约时上游返回空列表 → undefined（不是错误）。
   */
  async perpStats(cmcId: number): Promise<PerpStats | undefined> {
    const data = await this.client.get<CmcDerivativePairsResponse>(
      ENDPOINTS.derivatives.pairsByCrypto,
      // BTC 有 202 对；limit=500 实测仍是 1 credit
      { crypto_id: cmcId, limit: 500 },
      { cacheTtlMs: env.CACHE_TTL_DERIVATIVES_MS, softFail: true },
    );
    return aggregatePerpPairs(data?.market_pairs, { totalPairs: data?.num_market_pairs });
  }

  /**
   * 现货视角：按成交量取前 SPOT_PAIRS_LIMIT 个现货对，白名单内算各所占比。1 credit。
   * 端点的 num_market_pairs 等于返回条数而不是总数，所以 pairs 数只在未满上限时才准确。
   */
  async spotStats(cmcId: number): Promise<SpotStats | undefined> {
    const data = await this.client.get<CmcMarketPairsResponse>(
      ENDPOINTS.core.marketPairs,
      { id: cmcId, category: 'spot', limit: SPOT_PAIRS_LIMIT, sort: 'volume_24h_strict', sort_dir: 'desc' },
      { cacheTtlMs: env.CACHE_TTL_DERIVATIVES_MS, softFail: true },
    );
    return aggregateSpotPairs(data?.market_pairs, SPOT_PAIRS_LIMIT);
  }

  /** 名称 / symbol / slug 直接查主 API 行情（/perp 兜底：索引未就绪时用）。 */
  async marketDataBySymbol(symbol: string): Promise<CoreMarketData | undefined> {
    const data = await this.client.get<Record<string, CmcQuoteEntry[]>>(
      ENDPOINTS.core.quotes,
      { symbol: symbol.toUpperCase(), convert: 'USD' },
      { cacheTtlMs: env.CACHE_TTL_QUOTE_MS, softFail: true },
    );
    const entry = data?.[symbol.toUpperCase()]?.[0];
    return entry ? this.marketData(entry.id) : undefined;
  }

  /** 爆仓 1h / 4h / 24h 多空，CMC 已跨所汇总（9 家）。1 credit。 */
  async liquidations(cmcId: number): Promise<LiquidationStats | undefined> {
    const data = await this.client.get<{ cryptocurrencies?: CmcLiquidationEntry[] }>(
      ENDPOINTS.derivatives.liquidationsByCrypto,
      { crypto_id: cmcId },
      { cacheTtlMs: env.CACHE_TTL_DERIVATIVES_MS, softFail: true },
    );
    const entry = data?.cryptocurrencies?.find((c) => c.crypto_id === cmcId) ?? data?.cryptocurrencies?.[0];
    return toLiquidationStats(entry);
  }

  /** 批量行情（portfolio 用）：逗号传 id，1 credit / 100 个。 */
  async quotesBatch(cmcIds: number[]): Promise<Map<number, { priceUsd?: number; change24hPct?: number; marketCapUsd?: number }>> {
    const out = new Map<number, { priceUsd?: number; change24hPct?: number; marketCapUsd?: number }>();
    const ids = [...new Set(cmcIds)].slice(0, 100);
    if (ids.length === 0) return out;
    const data = await this.client.get<Record<string, CmcQuoteEntry>>(
      ENDPOINTS.core.quotes,
      { id: ids.join(','), convert: 'USD' },
      { cacheTtlMs: env.CACHE_TTL_QUOTE_MS, softFail: true },
    );
    for (const id of ids) {
      const usd = data?.[String(id)]?.quote?.['USD'];
      if (!usd) continue;
      out.set(id, {
        priceUsd: usd.price ?? undefined,
        change24hPct: usd.percent_change_24h ?? undefined,
        marketCapUsd: usd.market_cap ?? undefined,
      });
    }
    return out;
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
