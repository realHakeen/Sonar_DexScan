import { createLogger } from '../infra/logger.js';

const log = createLogger('dexscreener');
const BASE = 'https://api.dexscreener.com/latest/dex';

/**
 * Solana 地址是 base58，大小写敏感；DexScreener 的分享链接把地址整个转成了小写
 * （dexscreener.com/solana/hmh9syen…），CMC 的 pairs/quotes 和 search 都认不出来。
 * 只对「像 Solana 地址且没有一个大写字母」的输入做恢复；EVM 地址大小写无关，不需要。
 */
export function caseLost(address: string): boolean {
  return /^[1-9a-z]{32,44}$/.test(address);
}

export interface DexscreenerPair {
  pairAddress: string;
  tokenAddress: string;
  symbol?: string;
}

function firstPair(data: unknown): DexscreenerPair | undefined {
  const pairs = (data as { pairs?: unknown[] } | null)?.pairs;
  if (!Array.isArray(pairs)) return undefined;
  // 按流动性取最大的一条（tokens 端点会返回该币全部池子）
  let best: { liq: number; pair: DexscreenerPair } | undefined;
  for (const raw of pairs) {
    const p = raw as { pairAddress?: string; baseToken?: { address?: string; symbol?: string }; liquidity?: { usd?: number } };
    if (!p.pairAddress || !p.baseToken?.address) continue;
    const liq = Number(p.liquidity?.usd ?? 0);
    if (!best || liq > best.liq) best = { liq, pair: { pairAddress: p.pairAddress, tokenAddress: p.baseToken.address, symbol: p.baseToken.symbol } };
  }
  return best?.pair;
}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  return res.json();
}

/**
 * 用 DexScreener 公开接口（免费、无 key、大小写不敏感）把小写的池子 / 代币地址恢复成正确大小写，
 * 顺带拿到 base 代币地址，省掉 CMC 的 pairs/quotes 反查（1 credit）。任何失败都返回 undefined，调用方走原路径。
 */
export async function recoverPair(chainId: string, pairAddress: string): Promise<DexscreenerPair | undefined> {
  try {
    return firstPair(await get(`/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`));
  } catch (err) {
    log.warn('pair case recovery failed', { chainId, pairAddress, err: String(err) });
    return undefined;
  }
}

export async function recoverToken(tokenAddress: string): Promise<DexscreenerPair | undefined> {
  try {
    return firstPair(await get(`/tokens/${encodeURIComponent(tokenAddress)}`));
  } catch (err) {
    log.warn('token case recovery failed', { tokenAddress, err: String(err) });
    return undefined;
  }
}
