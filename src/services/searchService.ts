import { CANDIDATE_LIMIT, COIN_INDEX_RESOLVE_LIMIT, SEARCH_FETCH_LIMIT } from '../config/constants.js';
import type { CmcGateway } from '../api/cmc/index.js';
import { NotFoundError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { chainRegistry } from '../domain/chains.js';
import type { CoinIndex } from '../domain/coinIndex.js';
import { rankCandidates, type ScoredCandidate } from '../domain/ranking.js';
import type { TokenCandidate } from '../domain/types.js';
import { markOfficialContracts } from '../domain/verification.js';

const log = createLogger('searchService');

/** PRD F2：名称 / Symbol 搜索 + 重名消歧。 */
export class SearchService {
  constructor(
    private readonly cmc: CmcGateway,
    private readonly index: CoinIndex,
  ) {}

  /**
   * 三路并行取候选，合并后客户端重排：
   * 1. DEX search 文本相关性（symbol 匹配为主）
   * 2. DEX search sort=liquidity（同一候选集换个顺序，能多捞几条大池）
   * 3. 本地 CMC 收录索引（name / slug / symbol 精确命中）→ tokenDetail 拉完整数据
   * 第 3 路解决 "Teller" 这类 symbol 仿盘把正主挤出前 100 的问题。
   */
  async searchByName(query: string, limit = CANDIDATE_LIMIT): Promise<ScoredCandidate[]> {
    const [relevance, byLiquidity, indexed] = await Promise.all([
      this.cmc.dex.search(query, SEARCH_FETCH_LIMIT),
      this.cmc.dex.search(query, SEARCH_FETCH_LIMIT, 'liquidity').catch(() => [] as TokenCandidate[]),
      this.resolveFromIndex(query),
    ]);

    const pool = [...indexed, ...relevance, ...byLiquidity];
    if (pool.length === 0) throw new NotFoundError(query);

    const verified = await markOfficialContracts(this.cmc.core, pool, this.index);
    const ranked = rankCandidates(verified, query, limit);

    log.debug('search re-ranked', {
      query,
      relevance: relevance.length,
      byLiquidity: byLiquidity.length,
      indexed: indexed.length,
      top: ranked[0]?.candidate.symbol,
      topScore: ranked[0]?.score,
    });
    return ranked;
  }

  /** 本地索引命中 → tokenDetail 补齐行情。每条 1 credit，所以只取排名最前的几条。 */
  private async resolveFromIndex(query: string): Promise<TokenCandidate[]> {
    if (!this.index.isLoaded) return [];
    const hits = this.index.lookup(query, COIN_INDEX_RESOLVE_LIMIT);
    if (hits.length === 0) return [];

    const results = await Promise.allSettled(
      hits.map(async (hit) => {
        const networkSlug = hit.networkSlug ?? 'ethereum';
        const detail = await this.cmc.dex.tokenDetail({
          platform: chainRegistry.platformName(networkSlug),
          address: hit.address!,
          networkSlug,
        });
        if (!detail) return undefined;
        return {
          ...detail.candidate,
          cmcId: detail.candidate.cmcId ?? hit.cmcId,
          cmcRank: hit.rank,
          officialVerified: true,
        } satisfies TokenCandidate;
      }),
    );

    const out: TokenCandidate[] = [];
    for (const r of results) if (r.status === 'fulfilled' && r.value) out.push(r.value);
    log.debug('index resolved', { query, hits: hits.map((h) => `${h.symbol}@${h.networkSlug}`), resolved: out.length });
    return out;
  }
}
