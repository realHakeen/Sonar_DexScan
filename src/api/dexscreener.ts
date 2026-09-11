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
  /** DexScreener 的 base 代币（按它每条链的报价币名单选边）。Uniswap v4 原生币池子里 ETH 是零地址。 */
  tokenAddress: string;
  symbol?: string;
  quoteAddress?: string;
  quoteSymbol?: string;
}

function firstPair(data: unknown): DexscreenerPair | undefined {
  const pairs = (data as { pairs?: unknown[] } | null)?.pairs;
  if (!Array.isArray(pairs)) return undefined;
  // 按流动性取最大的一条（tokens 端点会返回该币全部池子）
  let best: { liq: number; pair: DexscreenerPair } | undefined;
  for (const raw of pairs) {
    const p = raw as { pairAddress?: string; baseToken?: { address?: string; symbol?: string }; quoteToken?: { address?: string; symbol?: string }; liquidity?: { usd?: number } };
    if (!p.pairAddress || !p.baseToken?.address) continue;
    const liq = Number(p.liquidity?.usd ?? 0);
    if (!best || liq > best.liq) best = { liq, pair: { pairAddress: p.pairAddress, tokenAddress: p.baseToken.address, symbol: p.baseToken.symbol, quoteAddress: p.quoteToken?.address, quoteSymbol: p.quoteToken?.symbol } };
  }
  return best?.pair;
}

async function get(path: string, timeoutMs = 10_000): Promise<unknown> {
  // 走代理时实测 3s 左右，4s 会擦边超时
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`dexscreener ${res.status}`);
  return res.json();
}

/**
 * 池子 → base 代币，用 DexScreener 公开接口（免费、无 key、大小写不敏感）。
 * 这是 DexScreener / GeckoTerminal 池子链接的主路径：它的 base/quote 按每条链的报价币名单选边，
 * 而 CMC pairs/quotes 的 base 只是合约里地址较小的 token0，报价币常被当成 base。
 * 顺带把小写的池子地址恢复成正确大小写。任何失败都返回 undefined，调用方退到 CMC。
 * 每条池子链接都要经过这里，超时压在 6s：扫描 handler 总预算 30s，不能让一个免费接口吃掉三分之一。
 */
export async function recoverPair(chainId: string, pairAddress: string): Promise<DexscreenerPair | undefined> {
  try {
    return firstPair(await get(`/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`, 6_000));
  } catch (err) {
    log.warn('pair lookup failed', { chainId, pairAddress, err: String(err) });
    return undefined;
  }
}

/** 项目方在 DexScreener 提交的资料：横幅图、头像、链接。/lore 用横幅当图片消息的封面；没提交过资料的币返回 undefined。 */
export interface DexscreenerProfile {
  header?: string;
  imageUrl?: string;
  websites: string[];
  socials: Array<{ type: string; url: string }>;
}

export function parseProfile(data: unknown, chainId?: string): DexscreenerProfile | undefined {
  const pairs = (data as { pairs?: unknown[] } | null)?.pairs;
  if (!Array.isArray(pairs)) return undefined;
  for (const raw of pairs) {
    const p = raw as { chainId?: string; info?: { header?: string; imageUrl?: string; websites?: Array<{ url?: string }>; socials?: Array<{ type?: string; url?: string }> } };
    if (chainId && p.chainId !== chainId) continue;
    const info = p.info;
    if (!info || (!info.header && !info.imageUrl)) continue;
    return {
      header: info.header,
      imageUrl: info.imageUrl,
      websites: (info.websites ?? []).map((w) => w.url).filter((u): u is string => Boolean(u)),
      socials: (info.socials ?? []).filter((s): s is { type: string; url: string } => Boolean(s.type && s.url)),
    };
  }
  return undefined;
}

export async function tokenProfile(tokenAddress: string, chainId?: string): Promise<DexscreenerProfile | undefined> {
  try {
    return parseProfile(await get(`/tokens/${encodeURIComponent(tokenAddress)}`), chainId);
  } catch (err) {
    log.debug('token profile fetch failed', { tokenAddress, err: String(err) });
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
