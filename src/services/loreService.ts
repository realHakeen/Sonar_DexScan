import type { DatabaseSync } from 'node:sqlite';
import type { CmcGateway } from '../api/cmc/index.js';
import type { TextGenerator } from '../api/gemini.js';
import { env } from '../config/env.js';
import { chainRegistry } from '../domain/chains.js';
import type { TokenCandidate } from '../domain/types.js';
import { fetchPageText, type PageText } from '../infra/fetchText.js';
import { tokenProfile, type DexscreenerProfile } from '../api/dexscreener.js';
import type { SkillResult } from '../api/cmc/skills.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('lore');

export interface Lore {
  symbol: string;
  name: string;
  networkSlug: string;
  address: string;
  text: string;
  /** 用到的素材：website / cmc / news / skill；为空表示没有任何正文，只给了链接。 */
  sources: string[];
  /** DexScreener 上项目方提交的横幅图，有就发图片消息。 */
  headerImage?: string;
  links: { website?: string; twitter?: string; telegram?: string };
  cached: boolean;
}

/**
 * prompt 或素材管线有实质改动时 +1：缓存行里记着生成时的版本，不一致就重新生成，部署后立刻生效，与时间无关。
 * v2（2026-09-10）：禁止模型评论素材本身；bundle 文案裁剪优先保留提到代币的句子。
 */
const PROMPT_VERSION = 2;

const SYSTEM = `You write "lore" blurbs for a Telegram crypto scanner bot. Given only the source material provided, write 3-5 sentences in English: first what the project is, then how the token is used, then notable mechanics or facts (launch date, supply, chain).
Rules:
- Use only facts present in the sources. Never invent partnerships, listings, prices, or hype. Present the project's own website claims as what the project says, not as verified fact.
- Never comment on the sources themselves: do not mention that they are thin, fragmented, incomplete, UI text, metadata, or that a description is missing. Do not mention which chain was scanned or that other chains may exist.
- News items are third-party reporting: you may use what they say the project is and does, phrased as reported ("described as", "launched as"). A CoinMarketCap research note's "framed in public discussion" / "narrative" parts are market chatter: phrase them as how the token is being talked about, never as fact.
- If the only substantive source is the CoinMarketCap listing sentence (chain, supply, launch platform), write 1-2 sentences with those facts, e.g. "<name> is a <chain> token launched on <platform> with a supply of <n>; the project has not published a description." Do not pad it.
- Only if the sources contain literally nothing about the project beyond its name and links, write exactly one sentence: "No public description of <name> is available yet." and stop.
- Plain text, no headings, no bullet points, no emoji, no markdown.`;

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
    private readonly fetchText: (url: string, keywords?: string[]) => Promise<PageText | undefined> = (url, keywords) => fetchPageText(url, { keywords }),
    private readonly ttlMs = env.LORE_CACHE_TTL_MS,
    private readonly fetchProfile: (address: string, chainId?: string) => Promise<DexscreenerProfile | undefined> = tokenProfile,
    /** CMC skill 兜底；默认不注入（测试里绝不能碰真接口），组合根按 LORE_CMC_SKILL 决定。 */
    private readonly runSkill?: (name: string, params: Record<string, unknown>) => Promise<SkillResult>,
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

    const chainId = chainRegistry.get(loc.networkSlug).dexscreenerId;
    const [page, cmcInfo, news, profile] = await Promise.all([
      c.website ? this.fetchText(c.website, [c.symbol, c.name]) : Promise.resolve(undefined),
      c.cmcId ? this.cmc.core.info(c.cmcId).catch(() => undefined) : Promise.resolve(undefined),
      c.cmcId ? this.cmc.core.news(c.cmcId, 5).catch(() => []) : Promise.resolve([]),
      this.fetchProfile(c.address, chainId),
    ]);
    // 横幅只在 DexScreener 资料里的链接和 CMC 登记的官网 / X 对得上时才用：它那边偶尔把别的项目的资料挂在这个合约上（4STOCK 拿到的是 Superstables 的图）
    const header = profile && profileMatches(profile, links) ? profile.header : undefined;
    const sources: string[] = [];
    if (page) sources.push('website');
    if (cmcInfo?.description) sources.push('cmc');
    if (news.length) sources.push('news');

    // 官网和新闻都空（four.meme / pump.fun 上的币常见）：CMC skill 兜底，它有链上画像和"市场怎么讲这个币"，20 credits、约 40s
    let skill: SkillResult | undefined;
    if (!page && news.length === 0 && this.runSkill && chainId) {
      skill = await this.runSkill('onchain_memecoin_token_profile', { contract_address: c.address, chain: chainId }).catch((err) => {
        log.warn('lore skill failed', { symbol: c.symbol, err: String(err) });
        return undefined;
      });
      if (skill?.ok && skill.analysis) sources.push('skill');
      else skill = undefined;
    }

    const user = buildPrompt(c, page, cmcInfo?.description, news, skill?.ok ? skill : undefined);
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
    // sources 列格式 "v2:website,cmc"；没有版本前缀（v1 时代）或版本不同 → 当没缓存
    const m = /^v(\d+):(.*)$/.exec(row.sources);
    if (!m || Number(m[1]) !== PROMPT_VERSION) return undefined;
    return { text: row.text, sources: m[2] ? m[2].split(',') : [], header: row.header ?? undefined };
  }

  private writeCache(networkSlug: string, address: string, text: string, sources: string[], header?: string): void {
    if (!this.db) return;
    try {
      this.db
        .prepare('INSERT INTO lore (network_slug, address, text, sources, header, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(network_slug, address) DO UPDATE SET text = excluded.text, sources = excluded.sources, header = excluded.header, created_at = excluded.created_at')
        .run(networkSlug, address.toLowerCase(), text, `v${PROMPT_VERSION}:${sources.join(',')}`, header ?? null, Date.now());
    } catch (err) {
      log.warn('lore cache write failed', { err: String(err) });
    }
  }
}

/** 喂给模型的素材。没有正文时明说，让模型按"素材不足"写短一点，而不是编。 */
/** 官网字段填的是发射平台首页（four.meme / pump.fun …）而不是项目自己的站：抓不到项目文字，但"在哪发射"本身是个事实。 */
const LAUNCHPAD_HOSTS: Record<string, string> = {
  'four.meme': 'four.meme',
  'pump.fun': 'pump.fun',
  'moonshot.com': 'Moonshot',
  'bonk.fun': 'bonk.fun',
  'letsbonk.fun': 'letsbonk.fun',
  'believe.app': 'Believe',
  'zora.co': 'Zora',
  'clanker.world': 'Clanker',
  'virtuals.io': 'Virtuals',
  'app.virtuals.io': 'Virtuals',
};

export function launchpadOf(website: string | undefined): string | undefined {
  if (!website) return undefined;
  try {
    const host = new URL(website).hostname.replace(/^www\./, '');
    return LAUNCHPAD_HOSTS[host];
  } catch {
    return undefined;
  }
}

export interface NewsItem {
  title: string;
  subtitle?: string;
  releasedAt?: string;
  source?: string;
}

export function buildPrompt(c: TokenCandidate, page: PageText | undefined, cmcDescription: string | undefined, news: NewsItem[] = [], skill?: SkillResult): string {
  const launchpad = launchpadOf(c.website);
  const parts = [
    // "on <chain>" 会让模型把多链项目写成"某链上的项目"（Delysium 被写成 BNB Chain 项目），改成"扫描的合约在哪条链"
    `Token: ${c.symbol} (${c.name}). Contract scanned on ${chainRegistry.displayName(c.networkSlug)} (the project may also exist on other chains). Website: ${c.website ?? '-'}. X: ${c.twitter ?? '-'}. Telegram: ${c.telegram ?? '-'}.${c.listedAt ? ` First DEX pool was created on ${new Date(c.listedAt).toISOString().slice(0, 10)} (past event).` : ''}`,
    launchpad ? `The website field points to the ${launchpad} launchpad, so the token was launched there and has no separate project site.` : '',
    cmcDescription ? `CoinMarketCap description:\n${cmcDescription.slice(0, 1500)}` : 'Not listed on CoinMarketCap (no CMC description).',
    news.length ? `Recent news about the project (headline — summary, source, date):\n${news.map((n) => `- ${n.title}${n.subtitle ? ` — ${n.subtitle}` : ''} (${n.source ?? 'unknown source'}${n.releasedAt ? `, ${n.releasedAt}` : ''})`).join('\n')}` : '',
    skill?.analysis ? `CoinMarketCap automated research note (${skill.status ?? 'ok'}, confidence ${skill.confidence ?? 'unknown'}):\n${skill.analysis.slice(0, 2500)}` : '',
    page
      ? `Project website text (${page.url})${page.kind === 'bundle' ? ' — extracted from the site\'s app bundle, so sentences may be fragmented or out of order; ignore UI labels and error messages' : ''}:\n${page.meta ? `${page.meta}\n` : ''}${page.text}`
      : 'Project website text: unavailable (no website, or the site has no readable text).',
  ];
  return parts.filter(Boolean).join('\n\n');
}

/** DexScreener 资料的网站或社交链接与 CMC 登记的官网 / X 至少有一个同域名（或同 X 账号）。 */
export function profileMatches(profile: DexscreenerProfile, links: { website?: string; twitter?: string; telegram?: string }): boolean {
  const hosts = (u: string | undefined) => {
    if (!u) return undefined;
    try {
      return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return undefined;
    }
  };
  const handle = (u: string | undefined) => /(?:x|twitter)\.com\/(?:i\/communities\/)?([A-Za-z0-9_]+)/i.exec(u ?? '')?.[1]?.toLowerCase();
  const ours = new Set([hosts(links.website), hosts(links.telegram)].filter(Boolean));
  const ourHandle = handle(links.twitter);
  for (const w of profile.websites) if (ours.has(hosts(w))) return true;
  for (const s of profile.socials) {
    if (ours.has(hosts(s.url))) return true;
    if (ourHandle && handle(s.url) === ourHandle) return true;
  }
  return false;
}
