import type { CoreApi } from '../api/cmc/coreApi.js';
import { createLogger } from '../infra/logger.js';
import type { CoinIndex } from './coinIndex.js';
import type { TokenCandidate } from './types.js';

const log = createLogger('verify');

/**
 * PRD F2 正版识别：CMC 认定的官方合约与候选地址一致 → 标记 officialVerified 并补 cid / 排名。
 * 本地索引已加载时零 API 调用；否则按候选各自的 symbol 查 map（0 credits，最多 4 个 symbol）。
 * 注意不能用查询词当 symbol —— 用户搜的是名称 "Teller"，币的 symbol 是 DEBIT。
 */
export async function markOfficialContracts(
  core: CoreApi,
  candidates: TokenCandidate[],
  index?: CoinIndex,
): Promise<TokenCandidate[]> {
  if (candidates.length === 0) return candidates;

  if (index?.isLoaded) {
    return candidates.map((c) => {
      const hit = index.byContract(c.address);
      if (!hit) return c;
      return { ...c, officialVerified: true, cmcId: c.cmcId ?? hit.cmcId, cmcRank: c.cmcRank ?? hit.rank };
    });
  }

  const symbols = [...new Set(candidates.map((c) => c.symbol.toUpperCase()))].slice(0, 4);
  const official = new Map<string, { id: number; rank?: number }>();
  await Promise.all(
    symbols.map(async (symbol) => {
      const entries = await core.officialContracts(symbol).catch((err) => {
        log.warn('map lookup failed, skipping official-contract check', { symbol, err: String(err) });
        return [];
      });
      for (const e of entries) {
        const addr = e.platform?.token_address?.toLowerCase();
        if (addr) official.set(addr, { id: e.id, rank: e.rank });
      }
    }),
  );

  return candidates.map((c) => {
    const hit = official.get(c.address.toLowerCase());
    if (!hit) return c;
    return { ...c, officialVerified: true, cmcId: c.cmcId ?? hit.id, cmcRank: c.cmcRank ?? hit.rank };
  });
}
