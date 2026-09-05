import type { DatabaseSync } from 'node:sqlite';
import { PORTFOLIO_MAX_TOKENS } from '../config/constants.js';
import type { CmcGateway } from '../api/cmc/index.js';
import { chainRegistry } from '../domain/chains.js';
import type { PortfolioEntry, TokenCandidate } from '../domain/types.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('portfolio');

export type AddResult = 'added' | 'exists' | 'full';

/** /portfolio 列表里的一行：存的条目 + 当前行情。 */
export interface PortfolioRow {
  entry: PortfolioEntry;
  priceUsd?: number;
  change24hPct?: number;
  /** 当前价 / 加入价 − 1，百分比。 */
  sinceAddedPct?: number;
  marketCapUsd?: number;
}

interface DbRow {
  user_id: number;
  network_slug: string;
  address: string;
  symbol: string;
  name: string | null;
  cmc_id: number | null;
  added_at: number;
  added_price_usd: number | null;
  added_mcap_usd: number | null;
}

function toEntry(r: DbRow): PortfolioEntry {
  return {
    userId: r.user_id,
    networkSlug: r.network_slug,
    address: r.address,
    symbol: r.symbol,
    name: r.name ?? undefined,
    cmcId: r.cmc_id ?? undefined,
    addedAt: r.added_at,
    addedPriceUsd: r.added_price_usd ?? undefined,
    addedMcapUsd: r.added_mcap_usd ?? undefined,
  };
}

/**
 * bot 自己的 portfolio：按 Telegram 用户存代币，与聊天无关（群里点的也进个人列表）。
 * 存的是"加入时的价格"，列表里给出自加入以来的涨跌。
 */
export class PortfolioService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly cmc: CmcGateway,
    private readonly maxTokens = PORTFOLIO_MAX_TOKENS,
  ) {}

  add(entry: Omit<PortfolioEntry, 'addedAt'> & { addedAt?: number }): AddResult {
    const key = { userId: entry.userId, networkSlug: entry.networkSlug, address: entry.address.toLowerCase() };
    if (this.has(key.userId, key.networkSlug, key.address)) return 'exists';
    if (this.size(key.userId) >= this.maxTokens) return 'full';
    this.db
      .prepare(
        `INSERT INTO portfolio (user_id, network_slug, address, symbol, name, cmc_id, added_at, added_price_usd, added_mcap_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        key.userId,
        key.networkSlug,
        key.address,
        entry.symbol,
        entry.name ?? null,
        entry.cmcId ?? null,
        entry.addedAt ?? Date.now(),
        entry.addedPriceUsd ?? null,
        entry.addedMcapUsd ?? null,
      );
    return 'added';
  }

  remove(userId: number, networkSlug: string, address: string): boolean {
    const r = this.db
      .prepare('DELETE FROM portfolio WHERE user_id = ? AND network_slug = ? AND address = ?')
      .run(userId, networkSlug, address.toLowerCase());
    return Number(r.changes) > 0;
  }

  has(userId: number, networkSlug: string, address: string): boolean {
    const r = this.db
      .prepare('SELECT 1 AS x FROM portfolio WHERE user_id = ? AND network_slug = ? AND address = ?')
      .get(userId, networkSlug, address.toLowerCase());
    return Boolean(r);
  }

  size(userId: number): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM portfolio WHERE user_id = ?').get(userId) as { n: number } | undefined;
    return Number(r?.n ?? 0);
  }

  list(userId: number): PortfolioEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM portfolio WHERE user_id = ? ORDER BY added_at DESC')
      .all(userId) as unknown as DbRow[];
    return rows.map(toEntry);
  }

  private async dexCandidate(entry: PortfolioEntry): Promise<TokenCandidate | undefined> {
    const detail = await this.cmc.dex
      .tokenDetail({ platform: chainRegistry.platformName(entry.networkSlug), address: entry.address, networkSlug: entry.networkSlug })
      .catch(() => null);
    if (detail?.candidate.priceUsd !== undefined) return detail.candidate;
    const found = await this.cmc.dex.search(entry.address);
    return found.find((c) => c.address.toLowerCase() === entry.address.toLowerCase() && c.networkSlug === entry.networkSlug) ?? found[0];
  }

  /**
   * 带当前行情的列表。有 cid 的走 quotes 批量（1 credit / 100 个），没有的逐个打 token 详情（各 1 credit）。
   * 单个行情失败只影响那一行。
   */
  async listWithQuotes(userId: number): Promise<PortfolioRow[]> {
    const entries = this.list(userId);
    if (entries.length === 0) return [];
    const withCid = entries.filter((e) => e.cmcId);
    const quotes = withCid.length ? await this.cmc.core.quotesBatch(withCid.map((e) => e.cmcId!)).catch(() => new Map()) : new Map();

    return Promise.all(
      entries.map(async (entry): Promise<PortfolioRow> => {
        let priceUsd: number | undefined;
        let change24hPct: number | undefined;
        let marketCapUsd: number | undefined;
        const q = entry.cmcId ? quotes.get(entry.cmcId) : undefined;
        if (q) {
          ({ priceUsd, change24hPct, marketCapUsd } = q);
        } else {
          // 非 cid 代币：先按链名直打 token 详情；链名与上游 plt 不一致（TON 等）时退到 search 反查
          const c = await this.dexCandidate(entry).catch((err) => {
            log.warn('portfolio quote failed', { symbol: entry.symbol, err: String(err) });
            return undefined;
          });
          priceUsd = c?.priceUsd;
          change24hPct = c?.priceChange24hPct;
          marketCapUsd = c?.listingMarketCapUsd ?? c?.fdvUsd;
        }
        const sinceAddedPct =
          priceUsd !== undefined && entry.addedPriceUsd !== undefined && entry.addedPriceUsd > 0 ? (priceUsd / entry.addedPriceUsd - 1) * 100 : undefined;
        return { entry, priceUsd, change24hPct, sinceAddedPct, marketCapUsd };
      }),
    );
  }
}
