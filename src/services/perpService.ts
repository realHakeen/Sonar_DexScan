import type { CmcGateway } from '../api/cmc/index.js';
import type { CoinIndex, CoinIndexHit } from '../domain/coinIndex.js';
import { isDominantCoin } from '../domain/derivatives.js';
import { parseInput } from '../domain/inputParser.js';
import type { CoreMarketData, LiquidationStats, PerpStats } from '../domain/types.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('perpService');

/** /perp 的完整视图。 */
export interface PerpView {
  cmcId: number;
  symbol: string;
  name: string;
  perp?: PerpStats;
  liquidations?: LiquidationStats;
  core?: CoreMarketData;
  degraded: string[];
}

export type PerpResolution =
  | { kind: 'coin'; cmcId: number; symbol: string; name: string }
  | { kind: 'ambiguous'; query: string; candidates: CoinIndexHit[] }
  | { kind: 'none' };

/** 消歧候选数上限。 */
const PERP_CANDIDATE_LIMIT = 5;

/**
 * /perp <symbol | 地址>：合约数据只认 cid，不需要链和合约地址。
 * symbol 走本地索引（0 credits，原生币也能查）；地址先查索引的官方合约，再退到 DEX search（1 credit）。
 */
export class PerpService {
  constructor(
    private readonly cmc: CmcGateway,
    private readonly index: CoinIndex,
  ) {}

  async resolve(input: string): Promise<PerpResolution> {
    const parsed = parseInput(input);
    if (parsed.kind === 'none') return { kind: 'none' };

    if (parsed.kind === 'address') {
      const hit = this.index.byContract(parsed.address);
      if (hit) return { kind: 'coin', cmcId: hit.cmcId, symbol: hit.symbol, name: hit.name };
      const found = await this.cmc.dex.search(parsed.address);
      const match = found.find((c) => c.address.toLowerCase() === parsed.address.toLowerCase() && c.cmcId);
      if (!match?.cmcId) return { kind: 'none' };
      return { kind: 'coin', cmcId: match.cmcId, symbol: match.symbol, name: match.name };
    }

    const hits = this.index.lookup(parsed.query, PERP_CANDIDATE_LIMIT, { includeNative: true });
    if (hits.length === 0) {
      // 索引未就绪（刚启动）时用主 API 按 symbol 兜底
      if (!this.index.isLoaded) {
        const core = await this.cmc.core.marketDataBySymbol(parsed.query);
        if (core) return { kind: 'coin', cmcId: core.cmcId, symbol: parsed.query.toUpperCase(), name: parsed.query };
      }
      return { kind: 'none' };
    }
    const top = hits[0]!;
    if (isDominantCoin(hits)) return { kind: 'coin', cmcId: top.cmcId, symbol: top.symbol, name: top.name };
    return { kind: 'ambiguous', query: parsed.query, candidates: hits };
  }

  /** 三路并发：合约对 / 爆仓 / 主 API 行情（市值与现货量做比值）。失败项降级。 */
  async view(cmcId: number, fallback?: { symbol: string; name: string }): Promise<PerpView> {
    const degraded: string[] = [];
    const [perpRes, liqRes, coreRes] = await Promise.allSettled([
      this.cmc.core.perpStats(cmcId),
      this.cmc.core.liquidations(cmcId),
      this.cmc.core.marketData(cmcId),
    ]);
    const settle = <T>(r: PromiseSettledResult<T>, label: string): T | undefined => {
      if (r.status === 'fulfilled') return r.value;
      degraded.push(label);
      log.warn('perp sub-request failed', { label, reason: String(r.reason) });
      return undefined;
    };
    const perp = settle(perpRes, 'derivatives');
    const liquidations = settle(liqRes, 'liquidations');
    const core = settle(coreRes, 'coreMarket');
    const hit = this.index.byCmcId(cmcId);
    const symbol = hit?.symbol ?? fallback?.symbol ?? String(cmcId);
    const name = hit?.name ?? fallback?.name ?? symbol;

    // 没有合约不是错误：渲染层给出"未在白名单交易所追踪到永续"的说明
    return { cmcId, symbol, name, perp, liquidations, core, degraded };
  }
}
