import { chainRegistry } from './chains.js';
import { looksLikeAddress } from './detectChain.js';

export type ParsedInput =
  | { kind: 'address'; address: string; chainSlug?: string; source: 'raw' | 'link' }
  /** explicit = 用户用 $TICKER 形式明确要查（群里允许触发） */
  | { kind: 'query'; query: string; explicit?: boolean }
  | { kind: 'none' };

/** $marscoin / $PEPE 这类 cashtag。2–15 位字母数字下划线，前面不能是字母数字（避免 US$100 之类误判）。 */
const CASHTAG_RE = /(?:^|[^A-Za-z0-9])\$([A-Za-z][A-Za-z0-9_]{1,14})\b/;

export function extractCashtag(text: string): string | undefined {
  const m = CASHTAG_RE.exec(text);
  return m?.[1];
}

/** 从链接域名直接推断链，零 API 消耗。 */
const HOST_TO_CHAIN: Record<string, string> = {
  'etherscan.io': 'ethereum',
  'bscscan.com': 'bnb',
  'basescan.org': 'base',
  'arbiscan.io': 'arbitrum',
  'polygonscan.com': 'polygon',
  'optimistic.etherscan.io': 'optimism',
  'snowtrace.io': 'avalanche',
  'snowscan.xyz': 'avalanche',
  'lineascan.build': 'linea',
  'scrollscan.com': 'scroll',
  'blastscan.io': 'blast',
  'era.zksync.network': 'zksync',
  'mantlescan.xyz': 'mantle',
  'sonicscan.org': 'sonic',
  'berascan.com': 'berachain',
  'uniscan.xyz': 'unichain',
  'cronoscan.com': 'cronos',
  'ftmscan.com': 'fantom',
  'solscan.io': 'solana',
  'solana.fm': 'solana',
  'pump.fun': 'solana',
  'tronscan.org': 'tron',
  'tonviewer.com': 'ton',
  'tonscan.org': 'ton',
  'suiscan.xyz': 'sui',
  'suivision.xyz': 'sui',
  'explorer.aptoslabs.com': 'aptos',
  'seitrace.com': 'sei',
};

/** 这些路径段是分类前缀，不是地址本身。 */
const PATH_NOISE = new Set([
  'token', 'tokens', 'address', 'coin', 'coins', 'account', 'accounts',
  'pools', 'pool', 'pairs', 'pair', 'dexscan', 'dex', 'currencies',
  'token20', 'nft', 'tx', 'assets', 'asset', 'mainnet', '#',
]);

const URL_RE = /https?:\/\/[^\s<>()]+/gi;

/**
 * PRD F5：从 DexScreener / DexScan / 区块浏览器链接里直接解析链名和地址。
 * 这是高频场景，全程零 API 消耗。
 */
export function parseLink(rawUrl: string): ParsedInput {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'none' };
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const segments = url.pathname
    .split('/')
    .map((s) => decodeURIComponent(s).trim())
    .filter((s) => s !== '' && s !== '#');

  // dex.coinmarketcap.com/token/{network}/{address}
  if (host === 'dex.coinmarketcap.com' || host === 'coinmarketcap.com') {
    const idx = segments.findIndex((s) => s === 'token' || s === 'dexscan');
    if (idx >= 0 && segments.length >= idx + 3) {
      const network = segments[idx + 1]!;
      const address = segments[idx + 2]!;
      if (looksLikeAddress(address)) {
        return { kind: 'address', address, chainSlug: network.toLowerCase(), source: 'link' };
      }
    }
  }

  // dexscreener.com/{chain}/{address}  |  geckoterminal.com/{chain}/pools/{address}
  if (host === 'dexscreener.com' || host === 'geckoterminal.com') {
    const chainSeg = segments[0];
    const address = segments.filter((s) => !PATH_NOISE.has(s.toLowerCase())).at(-1);
    if (chainSeg && address && looksLikeAddress(address)) {
      const spec = chainRegistry.fromDexscreenerId(chainSeg);
      return {
        kind: 'address',
        address,
        chainSlug: spec?.slug,
        source: 'link',
      };
    }
  }

  // birdeye.so/token/{address}?chain=solana
  const chainParam = url.searchParams.get('chain') ?? url.searchParams.get('network');

  // 通用区块浏览器：域名决定链，路径末段取地址
  const address = segments.filter((s) => !PATH_NOISE.has(s.toLowerCase())).at(-1);
  if (address && looksLikeAddress(address)) {
    const slug = HOST_TO_CHAIN[host] ?? (chainParam ? chainRegistry.fromDexscreenerId(chainParam)?.slug : undefined);
    return { kind: 'address', address, chainSlug: slug, source: 'link' };
  }

  return { kind: 'none' };
}

/** Telegram MessageEntity 的最小子集，域层不依赖 telegraf 类型。 */
export interface MessageEntityLike {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

/** 超链接文字背后的 URL（`text_link` entity），去重、排除正文里已可见的。 */
export function hiddenLinks(text: string, entities?: MessageEntityLike[]): string[] {
  if (!entities?.length) return [];
  const urls = entities
    .filter((e) => e.type === 'text_link' && typeof e.url === 'string' && e.url !== '')
    .map((e) => e.url!)
    .filter((u) => !text.includes(u));
  return [...new Set(urls)];
}

/**
 * 带 entity 的消息解析。播报 bot 常把 DexScreener 链接藏在 "DEX · GT" 这种链接文字里，正文里看不到 URL。
 * 优先级：可见地址 / 明文链接 > 隐藏链接里的地址 > 可见的名称查询。
 * 隐藏链接排在可见地址之后，是因为转发消息里的隐藏链接可能指向别的币（分享 / 推广链接）；
 * 但它优先于名称查询，因为地址比 "$PEPE" 这种查询更精确。
 */
export function parseMessage(text: string, entities?: MessageEntityLike[]): ParsedInput {
  const visible = parseInput(text);
  if (visible.kind === 'address') return visible;
  for (const url of hiddenLinks(text, entities)) {
    const parsed = parseLink(url);
    if (parsed.kind === 'address') return parsed;
  }
  return visible;
}

/**
 * 统一入口：把用户消息解析成可执行的扫描意图。
 * 顺序很重要 —— 先试链接（零消耗），再试裸地址，最后才当作名称搜索。
 */
export function parseInput(text: string): ParsedInput {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'none' };

  const urls = trimmed.match(URL_RE);
  if (urls) {
    for (const u of urls) {
      const parsed = parseLink(u.replace(/[.,;]+$/, ''));
      if (parsed.kind !== 'none') return parsed;
    }
  }

  if (looksLikeAddress(trimmed)) {
    return { kind: 'address', address: trimmed, source: 'raw' };
  }

  // 群聊里地址常混在一句话里，扫描每个词
  for (const token of trimmed.split(/[\s,;|]+/)) {
    if (looksLikeAddress(token)) {
      return { kind: 'address', address: token, source: 'raw' };
    }
  }

  // $TICKER：明确的查询意图，句子里带着也算
  const cashtag = extractCashtag(trimmed);
  if (cashtag) return { kind: 'query', query: cashtag, explicit: true };

  const query = trimmed.replace(/^[#/@]+/, '').trim();
  return isPlausibleQuery(query) ? { kind: 'query', query } : { kind: 'none' };
}

const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
/** 代币名 / ticker 的合法字符集：字母数字加少量分隔符。 */
const QUERY_SAFE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,31}$/;

/**
 * 判断一段文字像不像代币名，而不是普通聊天。
 * 中文没有空格，靠分词数量过滤不掉「今天行情怎么样大家怎么看」，
 * 所以对 CJK 单独用长度上限。
 */
function isPlausibleQuery(query: string): boolean {
  const chars = [...query];
  if (chars.length < 2 || chars.length > 32) return false;
  if (query.split(/\s+/).length > 3) return false;
  if (CJK.test(query)) return chars.length <= 6;
  return QUERY_SAFE.test(query);
}
