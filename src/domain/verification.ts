import type { CoreApi } from '../api/cmc/coreApi.js';
import { createLogger } from '../infra/logger.js';
import type { CoinIndex } from './coinIndex.js';
import type { TokenCandidate } from './types.js';

const log = createLogger('verify');

/**
 * PRD F2 正版识别：CMC 认定的官方合约与候选地址一致 → 标记 officialVerified 并补 cid / 排名。
 * 本地索引已加载时零 API 调用；否则按候选各自的 symbol 查 map（0 credits，最多 4 个 symbol）。
 * 注意不能用查询词当 symbol —— 用户搜的是名称 "Teller"，币的 symbol 是 DEBIT。
 *
 * map 每个币只给一条主平台合约（Delysium 只有 Ethereum，BSC / Solana 合约在 /v2/info 里），
 * 所以地址比对之外再认 DEX 记录自带的 cid：那是 CMC 自己把该合约挂到哪个币下面的结果（DexScan 的 CMC 徽标同源），
 * cid 命中索引且 symbol 一致即视为官方合约。按地址扫描的路径（scanService 用 cid 拉主 API）本来就是这么认的。
 */
export async function markOfficialContracts(
  core: CoreApi,
  candidates: TokenCandidate[],
  index?: CoinIndex,
): Promise<TokenCandidate[]> {
  if (candidates.length === 0) return candidates;

  if (index?.isLoaded) {
    return candidates.map((c) => {
      const byCid = c.cmcId ? index.byCmcId(c.cmcId) : undefined;
      const hit = index.byContract(c.address) ?? (byCid && byCid.symbol === c.symbol.toUpperCase() ? byCid : undefined);
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
