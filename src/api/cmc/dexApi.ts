import { env } from '../../config/env.js';
import { SEARCH_FETCH_LIMIT } from '../../config/constants.js';
import { createLogger } from '../../infra/logger.js';
import type { CmcClient } from './client.js';
import { ENDPOINTS, PAIR_QUOTE_AUX } from './endpoints.js';
import {
  asArray,
  asRecord,
  pickNumber,
  toHolderEntry,
  toHoldersOverview,
  toPoolInfo,
  toSecurityDetail,
  toSecurityScan,
  toTagDistribution,
  toTokenCandidate,
  toTokenDetail,
} from './mappers.js';
import type {
  Candle,
  HolderEntry,
  KlineInterval,
  KlineMode,
  HolderTag,
  HolderTagDistribution,
  HoldersOverview,
  PoolInfo,
  SecurityScan,
  TokenCandidate,
} from '../../domain/types.js';

const log = createLogger('dexApi');

/** 定位一个代币所需的全部信息。platform 是 search 给的 plt 原样，v1 端点大小写不敏感。 */
export interface TokenLocator {
  platform: string;
  address: string;
  networkSlug: string;
}

/** v1 端点统一参数。 */
function v1Params(loc: TokenLocator) {
  return { platform: loc.platform, address: loc.address };
}
function holdersParams(loc: TokenLocator, tag?: HolderTag) {
  return { platform: loc.platform, tokenAddress: loc.address, ...(tag ? { tag } : {}) };
}

/** CMC DEX 数据的领域门面。所有方法都已用真实 Key 实测。 */
export class DexApi {
  private readonly quoteOpts = { cacheTtlMs: env.CACHE_TTL_QUOTE_MS, softFail: true };
  private readonly holdersOpts = { cacheTtlMs: env.CACHE_TTL_HOLDERS_MS, softFail: true };
  private readonly securityOpts = { cacheTtlMs: env.CACHE_TTL_SECURITY_MS, softFail: true };

  constructor(private readonly client: CmcClient) {}

  /** F1/F2 唯一入口：地址、名称、symbol 通吃，并用于反查地址所在链。 */
  async search(q: string, limit = SEARCH_FETCH_LIMIT, sort?: 'liquidity'): Promise<TokenCandidate[]> {
    // 实测：limit 封顶 100；sort=liquidity 有效（其它 sort 值静默无效）；候选集仍由文本相关性预选
    const data = await this.client.get<unknown>(
      ENDPOINTS.dex.search,
      { q, limit, sort },
      { cacheTtlMs: env.CACHE_TTL_SEARCH_MS, softFail: true },
    );
    const rows = asArray(data);
    const out: TokenCandidate[] = [];
    for (const row of rows) {
      const c = toTokenCandidate(row);
      if (c) out.push(c);
    }
    log.debug('search done', { q, raw: rows.length, mapped: out.length });
    return out;
  }

  /**
   * 卡片主数据源：一次请求拿到基础信息、行情、24h 买卖统计、头部池子、CEX 上所、owner。
   * hld 对 EVM 代币经常为 0，持有人数以 holders 系端点为准。
   */
  async tokenDetail(loc: TokenLocator): Promise<{ candidate: TokenCandidate; pools: PoolInfo[] } | null> {
    const data = await this.client.get<unknown>(ENDPOINTS.dex.tokenDetail, v1Params(loc), this.quoteOpts);
    const rec = asRecord(data);
    if (!rec || Object.keys(rec).length === 0) return null;
    return toTokenDetail(rec);
  }

  /** 单独拉池子列表（tokenDetail.pls 已含前 10 个，通常不需要）。 */
  async tokenPools(loc: TokenLocator, size = 10): Promise<PoolInfo[]> {
    const data = await this.client.get<unknown>(ENDPOINTS.dex.tokenPools, { ...v1Params(loc), size }, this.quoteOpts);
    return asArray(data).map((pl) => toPoolInfo(pl, loc.address));
  }

  /** 安全检测（Binance / W3W 来源），EVM 与 Solana 通用。 */
  async securityDetail(loc: TokenLocator): Promise<SecurityScan | undefined> {
    const data = await this.client.get<unknown>(
      ENDPOINTS.dex.securityDetail,
      { platformName: loc.platform, address: loc.address },
      this.securityOpts,
    );
    return toSecurityDetail(asRecord(data));
  }

  /** 单个池子的行情 + GoPlus 扫描。需要池子地址，不在扫描主链路里。 */
  async pairQuote(loc: { networkSlug: string; pairAddress: string }): Promise<{
    candidate: TokenCandidate | null;
    security: SecurityScan | undefined;
  }> {
    const data = await this.client.get<unknown>(
      ENDPOINTS.dex.pairQuotes,
      { network_slug: loc.networkSlug, contract_address: loc.pairAddress, aux: PAIR_QUOTE_AUX, skip_invalid: true },
      this.quoteOpts,
    );
    const row = asRecord(data);
    if (!row) return { candidate: null, security: undefined };
    return { candidate: toTokenCandidate(row), security: toSecurityScan(row) };
  }

  // ---- Holder 系列 ----

  /** GET holders/count → 总数。 */
  async holdersCount(loc: TokenLocator): Promise<number | undefined> {
    const data = await this.client.get<unknown>(ENDPOINTS.dex.holdersCount, holdersParams(loc), this.holdersOpts);
    return toHoldersOverview(asRecord(data))?.totalHolders;
  }

  /** GET holders/trend/list 最新点 → holders 总数 + Top10/50/100 集中度。PRD 持仓结构区块的正式数据源。 */
  async holdersTrend(loc: TokenLocator): Promise<HoldersOverview | undefined> {
    const data = await this.client.get<unknown>(
      ENDPOINTS.dex.holdersTrendList,
      { ...holdersParams(loc), interval: '1d', limit: 2 },
      this.holdersOpts,
    );
    const points = asArray(data);
    if (points.length === 0) return undefined;
    // 日线点按 ts 升序；最新一点是今天（进行中），前一点是昨天 → 24h 变化
    const sorted = [...points].sort((a, b) => (pickNumber(a, 'ts', 'endTs') ?? 0) - (pickNumber(b, 'ts', 'endTs') ?? 0));
    const latest = sorted[sorted.length - 1]!;
    const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : undefined;
    const overview = toHoldersOverview(latest);
    if (!overview) return undefined;
    const prevCount = previous ? pickNumber(previous, 'count', 'holders', 'holderCount') : undefined;
    if (overview.totalHolders !== undefined && prevCount !== undefined && prevCount > 0) {
      overview.change24h = overview.totalHolders - prevCount;
      overview.change24hPct = ((overview.totalHolders - prevCount) / prevCount) * 100;
    }
    return overview;
  }

  /** GET holders/tag_count → 各标签持有人数与持仓占比。 */
  async holderTags(loc: TokenLocator): Promise<HolderTagDistribution | undefined> {
    const data = await this.client.get<unknown>(ENDPOINTS.dex.holdersTagCount, holdersParams(loc), this.holdersOpts);
    return toTagDistribution(data);
  }

  /** POST holders/list，可按标签过滤。/th /nh 用；集中度缺失时也用它推算。 */
  async holdersList(loc: TokenLocator, tag: HolderTag = 'tag_all'): Promise<HolderEntry[]> {
    const data = await this.client.post<unknown>(ENDPOINTS.dex.holdersList, holdersParams(loc, tag), this.holdersOpts);
    return asArray(data).map(toHolderEntry);
  }

  /**
   * K 线。代币地址即可，不需要池子。pm='m' 返回市值口径（price × 总供应）。
   * 返回按时间升序；上游给的是 [o,h,l,c,v,ts,traders] 数组。
   */
  async klineCandles(
    loc: TokenLocator,
    opts: { interval?: KlineInterval; limit?: number; pm?: KlineMode } = {},
  ): Promise<Candle[]> {
    const data = await this.client.get<unknown>(
      ENDPOINTS.dex.klineCandles,
      { ...v1Params(loc), interval: opts.interval ?? '1h', limit: opts.limit ?? 168, pm: opts.pm ?? 'p', unit: 'usd' },
      { cacheTtlMs: env.CACHE_TTL_CHART_MS, softFail: true },
    );
    if (!Array.isArray(data)) return [];
    const out: Candle[] = [];
    for (const row of data) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const [o, h, l, c, v, ts, tr] = row.map((x) => (typeof x === 'string' ? Number(x) : x)) as number[];
      if (![o, h, l, c, ts].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
      out.push({ open: o!, high: h!, low: l!, close: c!, volumeUsd: Number.isFinite(v) ? v! : 0, ts: ts! < 1e12 ? ts! * 1000 : ts!, traders: Number.isFinite(tr) ? tr : undefined });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  /** 启动时拉一次用于校准链注册表（实测上游 500，已容错）。 */
  async networks(): Promise<Array<{ id?: number; slug: string; name?: string }>> {
    const data = await this.client.get<unknown>(ENDPOINTS.dex.networks, { limit: 500 }, { cacheTtlMs: env.CACHE_TTL_META_MS, softFail: true });
    return asArray(data)
      .map((r) => ({
        id: typeof r['id'] === 'number' ? (r['id'] as number) : undefined,
        slug: String(r['network_slug'] ?? r['slug'] ?? ''),
        name: typeof r['name'] === 'string' ? (r['name'] as string) : undefined,
      }))
      .filter((n) => n.slug !== '');
  }
}
