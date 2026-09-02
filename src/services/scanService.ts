import { SECONDARY_CHAIN_HINT_LIMIT } from '../config/constants.js';
import type { CmcGateway, TokenLocator } from '../api/cmc/index.js';
import { AppError, NotFoundError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { chainRegistry } from '../domain/chains.js';
import type { CoinIndex } from '../domain/coinIndex.js';
import { detectChain } from '../domain/detectChain.js';
import { concentrationFromHolders, tagDistributionFromHolders } from '../domain/holders.js';
import { splitByChain } from '../domain/ranking.js';
import { evaluateRisks } from '../domain/risk.js';
import { markOfficialContracts } from '../domain/verification.js';
import type { CoreMarketData, PoolInfo, TokenCandidate, TokenReport } from '../domain/types.js';

const log = createLogger('scanService');

export interface ScanOptions {
  /** 用户从 inline button 切链，或链接里已带链名（registry slug）。 */
  chainSlug?: string;
}

/** search 漏索引或挂掉时，对无链提示的 EVM 地址并行探测这些链（按 DEX 活跃度排序）。 */
const EVM_PROBE_CHAINS = ['bnb', 'ethereum', 'base', 'arbitrum'];

function settled<T>(r: PromiseSettledResult<T>, label: string, degraded: string[]): T | undefined {
  if (r.status === 'fulfilled') return r.value;
  degraded.push(label);
  log.warn('sub-request failed, rendering degraded', { label, reason: String(r.reason) });
  return undefined;
}

/** 避免 undefined 把已有值覆盖掉。 */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

function locatorOf(c: TokenCandidate): TokenLocator {
  return {
    platform: c.platform ?? chainRegistry.platformName(c.networkSlug),
    address: c.address,
    networkSlug: c.networkSlug,
  };
}

/** PRD F1 + F3：地址 → 完整尽调卡片的编排层。 */
export class ScanService {
  constructor(
    private readonly cmc: CmcGateway,
    private readonly index?: CoinIndex,
  ) {}

  /** 按合约地址扫描。 */
  async scanByAddress(address: string, opts: ScanOptions = {}): Promise<TokenReport> {
    const detection = detectChain(address);

    // 定链：search 反查（EVM 一个地址可能多链部署），命中多条按流动性取主链。
    // search 挂掉不立刻放弃 —— 后面还有按链探测的兜底，最后再决定报什么错。
    let searchError: unknown;
    const found = await this.cmc.dex.search(address).catch((err) => {
      searchError = err;
      log.warn('search failed, probing chains', { err: String(err) });
      return [] as TokenCandidate[];
    });
    const matched = found.filter((c) => c.address.toLowerCase() === address.toLowerCase());
    const pool = matched.length > 0 ? matched : found;

    let primary: TokenCandidate | undefined;
    let secondary: TokenCandidate[] = [];

    if (pool.length > 0) {
      if (opts.chainSlug) {
        primary = pool.find((c) => c.networkSlug === opts.chainSlug);
        secondary = pool.filter((c) => c !== primary);
      }
      if (!primary) ({ primary, secondary } = splitByChain(pool));
    }

    // search 漏索引（新币常见）或挂掉：直接打 tokenDetail 兜底。
    // 链已知打一条；EVM 无提示时并行探测几条主链，取流动性最高的。
    if (!primary) {
      const known = opts.chainSlug ?? detection.slug ?? detection.candidates[0];
      const slugs = known ? [known] : detection.family === 'evm' ? EVM_PROBE_CHAINS : [];
      const probed = await Promise.allSettled(
        slugs.map((slug) => this.cmc.dex.tokenDetail({ platform: chainRegistry.platformName(slug), address, networkSlug: slug })),
      );
      const hits = probed
        .map((r) => (r.status === 'fulfilled' ? r.value?.candidate : undefined))
        .filter((c): c is TokenCandidate => Boolean(c));
      if (hits.length === 0) {
        // 探测也全失败且 search 是网络问题 → 报网络错误而不是"未找到"
        const allNetwork = probed.every((r) => r.status === 'rejected');
        if (searchError instanceof AppError && allNetwork) throw searchError;
        throw new NotFoundError(address);
      }
      ({ primary, secondary } = splitByChain(hits));
      log.info('chain probe hit', { chains: hits.map((h) => h.networkSlug), primary: primary?.networkSlug });
    }
    if (!primary) throw new NotFoundError(address);

    // 流动性恰好为 0 的同地址部署是索引噪音；$2 这种残留池恰恰是 PRD 要提示的
    const meaningful = secondary.filter((c) => (c.liquidityUsd ?? 0) > 0);
    return this.buildReport(primary, meaningful.slice(0, SECONDARY_CHAIN_HINT_LIMIT));
  }

  async scanByLocator(loc: { networkSlug: string; address: string }): Promise<TokenReport> {
    return this.scanByAddress(loc.address, { chainSlug: loc.networkSlug });
  }

  /**
   * 聚合一张卡片。PRD F6：所有详情端点并发。
   * 每次扫描固定 5 个并发请求（token / security / trend / tag_count / core），失败项降级不影响整卡。
   */
  async buildReport(primary: TokenCandidate, secondary: TokenCandidate[]): Promise<TokenReport> {
    const loc = locatorOf(primary);
    const degraded: string[] = [];
    const startedAt = Date.now();

    const [detailRes, securityRes, trendRes, tagsRes, coreRes] = await Promise.allSettled([
      this.cmc.dex.tokenDetail(loc),
      this.cmc.dex.securityDetail(loc),
      this.cmc.dex.holdersTrend(loc),
      this.cmc.dex.holderTags(loc),
      primary.cmcId
        ? this.cmc.core.marketData(primary.cmcId)
        : markOfficialContracts(this.cmc.core, [primary], this.index),
    ]);

    const detail = settled(detailRes, 'tokenDetail', degraded);
    const security = settled(securityRes, 'security', degraded);
    let holders = settled(trendRes, 'holdersTrend', degraded);
    let tags = settled(tagsRes, 'holderTags', degraded);

    // tokenDetail 字段比 search 全，用它覆盖 —— 但链身份除外：
    // tokenDetail.plt 是长名（"Robinhood Chain" / "BNB Smart Chain (BEP20)"），search.plt 才是短名，且所有 v1 请求都是用它发的
    let merged: TokenCandidate = detail
      ? {
          ...primary,
          ...stripUndefined(detail.candidate),
          networkSlug: primary.networkSlug,
          platform: primary.platform ?? detail.candidate.platform,
          networkId: primary.networkId ?? detail.candidate.networkId,
          raw: detail.candidate.raw,
        }
      : primary;
    const pools: PoolInfo[] = detail?.pools ?? [];

    // ---- 持有人数：trend → count → tokenDetail.hld ----
    if (holders?.totalHolders === undefined) {
      const count = await this.cmc.dex.holdersCount(loc).catch(() => {
        degraded.push('holdersCount');
        return undefined;
      });
      const total = count ?? merged.holdersCount;
      if (total !== undefined) holders = { ...holders, totalHolders: total };
    }

    // ---- 集中度 / 标签兜底：只有缺失时才多打一次 holders/list ----
    const missingConcentration = holders?.top10Pct === undefined;
    const missingTags = !tags || Object.values(tags).every((v) => v === undefined || (typeof v === 'object' && Object.keys(v).length === 0));
    if (missingConcentration || missingTags) {
      const list = await this.cmc.dex.holdersList(loc, 'tag_all').catch((err) => {
        degraded.push('holderList');
        log.warn('holders/list fallback failed', { reason: String(err) });
        return [];
      });
      if (list.length > 0) {
        if (missingConcentration) holders = { ...holders, ...stripUndefined(concentrationFromHolders(list)) };
        if (missingTags) tags = tagDistributionFromHolders(list) ?? tags;
      }
    }

    // ---- 主 API：真实流通市值 / 排名 / 赛道 ----
    let core: CoreMarketData | undefined;
    const coreValue = settled(coreRes, 'coreMarket', degraded);
    if (Array.isArray(coreValue)) {
      const v = coreValue[0];
      if (v) merged = { ...merged, officialVerified: v.officialVerified, cmcId: v.cmcId ?? merged.cmcId };
      if (merged.cmcId) {
        core = await this.cmc.core.marketData(merged.cmcId).catch(() => {
          degraded.push('coreMarket');
          return undefined;
        });
      }
    } else {
      core = coreValue;
      if (core) merged = { ...merged, officialVerified: merged.officialVerified ?? true };
    }
    // 主 API 不可用时，用 tokenDetail.lmc 兜底真实流通市值
    if (!core?.marketCapUsd && merged.listingMarketCapUsd && merged.cmcId) {
      core = { cmcId: merged.cmcId, categories: [], ...core, marketCapUsd: merged.listingMarketCapUsd };
    }

    const risks = evaluateRisks({ primary: merged, secondaryDeployments: secondary, holders, tags, security, pools });

    log.info('report built', {
      symbol: merged.symbol,
      chain: merged.networkSlug,
      elapsed: Date.now() - startedAt,
      degraded,
    });

    return { primary: merged, secondaryDeployments: secondary, holders, tags, security, pools, core, risks, degraded, generatedAt: Date.now() };
  }
}
