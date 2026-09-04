import type { CmcMapEntry } from '../api/cmc/types.js';
import { normalizeNetworkSlug } from './chains.js';

/** 本地索引里的一条 CMC 收录记录。 */
export interface CoinIndexHit {
  cmcId: number;
  name: string;
  symbol: string;
  slug: string;
  rank?: number;
  /** 链注册表 slug（由 platform.name 归一），无平台的原生币为 undefined。 */
  networkSlug?: string;
  /** CMC 认定的官方合约地址。 */
  address?: string;
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * /v1/cryptocurrency/map 全量（~8k 条、0 credits）的内存索引。
 * 作用：
 * 1. 名称搜索的权威通路 —— DEX search 按文本相关性取前 100 时，name 匹配常被 symbol 仿盘挤出去
 *    （搜 "Teller" 100 条里没有 DEBIT），本地索引一击命中。
 * 2. 正版识别改为本地地址比对，不再每次调 map。
 */
export class CoinIndex {
  private byId = new Map<number, CoinIndexHit>();
  private bySlug = new Map<string, CoinIndexHit>();
  private byName = new Map<string, CoinIndexHit[]>();
  private bySymbol = new Map<string, CoinIndexHit[]>();
  private byAddress = new Map<string, CoinIndexHit>();
  private loadedAt = 0;

  get size(): number {
    return this.byId.size;
  }

  get isLoaded(): boolean {
    return this.byId.size > 0;
  }

  get ageMs(): number {
    return this.loadedAt ? Date.now() - this.loadedAt : Infinity;
  }

  load(entries: CmcMapEntry[]): void {
    const byId = new Map<number, CoinIndexHit>();
    const bySlug = new Map<string, CoinIndexHit>();
    const byName = new Map<string, CoinIndexHit[]>();
    const bySymbol = new Map<string, CoinIndexHit[]>();
    const byAddress = new Map<string, CoinIndexHit>();

    for (const e of entries) {
      if (!e || typeof e.id !== 'number' || !e.name || !e.symbol) continue;
      const address = e.platform?.token_address?.trim() || undefined;
      const hit: CoinIndexHit = {
        cmcId: e.id,
        name: e.name,
        symbol: e.symbol.toUpperCase(),
        slug: e.slug ?? slugify(e.name),
        rank: typeof e.rank === 'number' ? e.rank : undefined,
        networkSlug: e.platform?.name ? normalizeNetworkSlug(e.platform.name) : undefined,
        address,
      };
      byId.set(hit.cmcId, hit);
      bySlug.set(hit.slug, hit);
      push(byName, hit.name.toLowerCase(), hit);
      push(bySymbol, hit.symbol, hit);
      if (address) byAddress.set(address.toLowerCase(), hit);
    }

    this.byId = byId;
    this.bySlug = bySlug;
    this.byName = byName;
    this.bySymbol = bySymbol;
    this.byAddress = byAddress;
    this.loadedAt = Date.now();
  }

  /** 官方合约比对：地址命中即为 CMC 收录的正版。 */
  byContract(address: string): CoinIndexHit | undefined {
    return this.byAddress.get(address.toLowerCase());
  }

  byCmcId(id: number): CoinIndexHit | undefined {
    return this.byId.get(id);
  }

  /**
   * 名称 / slug / symbol 查询，精确匹配优先，其次名称前缀。
   * 结果按 CMC 排名升序。默认只返回有合约地址的（原生币没有 DEX 合约可扫）；
   * includeNative 用于不需要合约的场景（/perp 只认 cid，BTC / ETH 反而最有看头）。
   */
  lookup(query: string, limit = 5, opts: { includeNative?: boolean } = {}): CoinIndexHit[] {
    const q = query.trim();
    if (q.length < 2) return [];
    const lower = q.toLowerCase();
    const upper = q.toUpperCase();

    const seen = new Set<number>();
    const out: CoinIndexHit[] = [];
    const take = (hits: Iterable<CoinIndexHit | undefined>) => {
      for (const h of hits) {
        if (!h || seen.has(h.cmcId)) continue;
        seen.add(h.cmcId);
        out.push(h);
      }
    };

    take([this.bySlug.get(slugify(q))]);
    take(this.byName.get(lower) ?? []);
    take(this.bySymbol.get(upper) ?? []);

    // 前缀匹配只在精确命中不足时启用，且要求 ≥3 个字符，避免 "ai" 命中几百条
    if (out.length < limit && lower.length >= 3) {
      const prefix: CoinIndexHit[] = [];
      for (const [name, hits] of this.byName) {
        if (name.startsWith(lower)) prefix.push(...hits);
        if (prefix.length > 50) break;
      }
      take(prefix.sort(byRank));
    }

    return out
      .filter((h) => opts.includeNative || h.address)
      .sort(byRank)
      .slice(0, limit);
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function byRank(a: CoinIndexHit, b: CoinIndexHit): number {
  return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
}
