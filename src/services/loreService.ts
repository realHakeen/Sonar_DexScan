import type { DatabaseSync } from 'node:sqlite';
import type { CmcGateway } from '../api/cmc/index.js';
import type { TextGenerator } from '../api/gemini.js';
import { env } from '../config/env.js';
import { chainRegistry } from '../domain/chains.js';
import type { TokenCandidate } from '../domain/types.js';
import { fetchPageText, type PageText } from '../infra/fetchText.js';
import { tokenProfile, type DexscreenerProfile } from '../api/dexscreener.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('lore');

export interface Lore {
  symbol: string;
  name: string;
  networkSlug: string;
  address: string;
  text: string;
  /** 用到的素材：website / cmc；为空表示没有任何正文，只给了链接。 */
  sources: string[];
  /** DexScreener 上项目方提交的横幅图，有就发图片消息。 */
  headerImage?: string;
  links: { website?: string; twitter?: string; telegram?: string };
  cached: boolean;
}

const SYSTEM = `You write "lore" blurbs for a Telegram crypto scanner bot. Given only the source material provided, write 3-5 sentences in English explaining what the project is, how the token is used, and any notable facts (launch, chain, mechanics). Rules: use only facts present in the sources; never invent partnerships, listings, prices, or hype; treat the project's own website claims as claims, not verified facts; if the sources are thin, say so in one short sentence and stop; do not describe the metadata line itself (which chain was scanned, that other chains may exist, that a description is missing) unless it is the only thing you can say. Plain text, no headings, no bullet points, no emoji, no markdown.`;

/**
 * /lore：项目简介。素材 = CMC DEX token 资料（名字、链、官网、X、TG）+ 官网正文（服务端渲染的才抓得到）+ CMC 收录描述，
 * 交给模型压成 3–5 句。按币缓存 LORE_CACHE_TTL_MS（默认 24h）。credits：tokenDetail 1 + 收录币 info 1；模型走 Gemini 免费档。
 * 不做 X 抓取（没有数据源），不做 JS 渲染（官网抓不到正文时只给链接并说明素材不足）。
 */
export class LoreService {
  constructor(
    private readonly cmc: CmcGateway,
    private readonly generate: TextGenerator | undefined,
    private readonly db?: DatabaseSync,
    private readonly fetchText: (url: string) => Promise<PageText | undefined> = fetchPageText,
    private readonly ttlMs = env.LORE_CACHE_TTL_MS,
    private readonly fetchProfile: (address: string, chainId?: string) => Promise<DexscreenerProfile | undefined> = tokenProfile,
  ) {}

  get enabled(): boolean {
    return this.generate !== undefined;
  }

  /** 已定位的代币（链 + 地址）→ lore。抛错由命令层转成用户提示。 */
  async forToken(loc: { networkSlug: string; address: string }): Promise<Lore> {
    if (!this.generate) throw new Error('lore is not configured (LORE_API_KEY missing)');
    const detail = await this.cmc.dex.tokenDetail({ platform: chainRegistry.platformName(loc.networkSlug), address: loc.address, networkSlug: loc.networkSlug });
    const c = detail?.candidate;
    if (!c) throw new Error('token not found');
    const cached = this.readCache(loc.networkSlug, c.address);
    const links = { website: c.website, twitter: c.twitter, telegram: c.telegram };
    if (cached) return { symbol: c.symbol, name: c.name, networkSlug: loc.networkSlug, address: c.address, text: cached.text, sources: cached.sources, headerImage: cached.header, links, cached: true };

    const [page, cmcInfo, profile] = await Promise.all([
      c.website ? this.fetchText(c.website) : Promise.resolve(undefined),
      c.cmcId ? this.cmc.core.info(c.cmcId).catch(() => undefined) : Promise.resolve(undefined),
      this.fetchProfile(c.address, chainRegistry.get(loc.networkSlug).dexscreenerId),
    ]);
    const header = profile?.header;
    const sources: string[] = [];
    if (page) sources.push('website');
    if (cmcInfo?.description) sources.push('cmc');

    const user = buildPrompt(c, page, cmcInfo?.description);
    const started = Date.now();
    const out = await this.generate(SYSTEM, user);
    log.info('lore generated', { symbol: c.symbol, chain: loc.networkSlug, sources, elapsed: Date.now() - started, in: out.inputTokens, out: out.outputTokens });
    // 素材为空多半是官网 / 接口一时抓不到，不缓存，下次再试；有素材的才存 24h
    if (sources.length > 0) this.writeCache(loc.networkSlug, c.address, out.text, sources, header);
    return { symbol: c.symbol, name: c.name, networkSlug: loc.networkSlug, address: c.address, text: out.text, sources, headerImage: header, links, cached: false };
  }

  private readCache(networkSlug: string, address: string): { text: string; sources: string[]; header?: string } | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare('SELECT text, sources, header, created_at FROM lore WHERE network_slug = ? AND address = ?').get(networkSlug, address.toLowerCase()) as
      | { text: string; sources: string; header: string | null; created_at: number }
      | undefined;
    if (!row || row.created_at < Date.now() - this.ttlMs) return undefined;
    return { text: row.text, sources: row.sources ? row.sources.split(',') : [], header: row.header ?? undefined };
  }

  private writeCache(networkSlug: string, address: string, text: string, sources: string[], header?: string): void {
    if (!this.db) return;
    try {
      this.db
        .prepare('INSERT INTO lore (network_slug, address, text, sources, header, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(network_slug, address) DO UPDATE SET text = excluded.text, sources = excluded.sources, header = excluded.header, created_at = excluded.created_at')
        .run(networkSlug, address.toLowerCase(), text, sources.join(','), header ?? null, Date.now());
    } catch (err) {
      log.warn('lore cache write failed', { err: String(err) });
    }
  }
}

/** 喂给模型的素材。没有正文时明说，让模型按"素材不足"写短一点，而不是编。 */
export function buildPrompt(c: TokenCandidate, page: PageText | undefined, cmcDescription: string | undefined): string {
  const parts = [
    // "on <chain>" 会让模型把多链项目写成"某链上的项目"（Delysium 被写成 BNB Chain 项目），改成"扫描的合约在哪条链"
    `Token: ${c.symbol} (${c.name}). Contract scanned on ${chainRegistry.displayName(c.networkSlug)} (the project may also exist on other chains). Website: ${c.website ?? '-'}. X: ${c.twitter ?? '-'}. Telegram: ${c.telegram ?? '-'}.${c.listedAt ? ` First DEX pool was created on ${new Date(c.listedAt).toISOString().slice(0, 10)} (past event).` : ''}`,
    cmcDescription ? `CoinMarketCap description:\n${cmcDescription.slice(0, 1500)}` : 'Not listed on CoinMarketCap (no CMC description).',
    page
      ? `Project website text (${page.url})${page.kind === 'bundle' ? ' — extracted from the site\'s app bundle, so sentences may be fragmented or out of order; ignore UI labels and error messages' : ''}:\n${page.meta ? `${page.meta}\n` : ''}${page.text}`
      : 'Project website text: unavailable (no website, or the site has no readable text).',
  ];
  return parts.join('\n\n');
}
