import { CANDIDATE_LIMIT, CARD_CACHE_TTL_MS, PLACEHOLDER_TEXT } from '../../config/constants.js';
import { TtlCache } from '../../infra/cache.js';
import { InvalidInputError, NotFoundError, toUserMessage } from '../../infra/errors.js';
import type { ParsedInput } from '../../domain/inputParser.js';
import type { ScoredCandidate } from '../../domain/ranking.js';
import type { TokenReport } from '../../domain/types.js';
import { Markup } from 'telegraf';
import { renderScanCard } from '../../render/card.js';
import { escapeHtml } from '../../render/format.js';
import { renderCandidateList } from '../../render/candidates.js';
import { candidateKeyboard, scanCardKeyboard } from '../../render/keyboards.js';
import { encodeCallback } from '../callbackData.js';
import { isGroup, type BotContext } from '../context.js';
import { renderBannerPng } from '../../render/banner.js';
import { formatCallAge, formatMultiple, userLink } from '../../domain/calls.js';
import { formatUsdShort } from '../../render/format.js';
import type { TrackResult } from '../../services/callService.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export interface ScanFlowOptions {
  /** 已有消息 id 时走编辑，否则先发占位消息。用于按钮回调。 */
  editMessageId?: number;
  /**
   * 编辑已有消息时的即时反馈方式：
   * - 'replace'：整条消息换成占位文案并撤掉按钮（候选选择 / 切链 / 展开）
   * - 'keep'：保留原卡片，只把按钮换成「⏳ Refreshing…」（刷新）
   */
  busyMode?: 'replace' | 'keep';
  /** 占位文案里的上下文，如 "TRIA · BNB Chain"。 */
  busyLabel?: string;
  /**
   * 回调路径也允许创建首次 call（候选选择 / 切链：点按钮的人就是把这个币带进群的人）。
   * Refresh / Back 不传，只更新不创建。
   */
  recordCall?: boolean;
  /** 统计用的触发方式：address / link / cashtag / name / forward / command / refresh / candidate / chain / back / watchlist。 */
  trigger?: string;
}

/** 正在扫描中的消息，key = chatId:messageId。防止用户连点导致重复请求。 */
const inflight = new Set<string>();

/** 最近一次渲染到某条消息上的卡片（正文 + 按钮 + 图表预览），供 perp 视图的 Back 零成本回填。 */
interface RenderedCard {
  text: string;
  extra: Record<string, unknown>;
  /** 加入 portfolio 时要记的"当时"数据，免得再打一次接口。 */
  snapshot: CardSnapshot;
}

export interface CardSnapshot {
  cmcId?: number;
  symbol: string;
  name: string;
  networkSlug: string;
  address: string;
  priceUsd?: number;
  marketCapUsd?: number;
}

/** 最近一次渲染到该消息的代币快照（10 分钟内）。 */
export function cachedSnapshot(chatId: number, messageId: number): CardSnapshot | undefined {
  return cardCache.get(`${chatId}:${messageId}`)?.snapshot;
}
const cardCache = new TtlCache<RenderedCard>(CARD_CACHE_TTL_MS, 5000);

/**
 * 把消息恢复成缓存的扫描卡。返回 false 表示缓存过期（10 分钟）或进程重启过，调用方应退回重扫。
 */
export async function restoreCard(ctx: BotContext, messageId: number): Promise<boolean> {
  const chatId = ctx.chat!.id;
  const cached = cardCache.get(`${chatId}:${messageId}`);
  if (!cached) return false;
  await ctx.telegram.editMessageText(chatId, messageId, undefined, cached.text, cached.extra as Parameters<typeof ctx.telegram.editMessageText>[4]);
  return true;
}

export function isScanInflight(chatId: number, messageId: number): boolean {
  return inflight.has(`${chatId}:${messageId}`);
}

/**
 * PRD F6 响应体验：
 * 立即回占位消息 → 后台并发取数 → editMessageText 换成完整卡片。
 * 所有入口（私聊、群聊、按钮回调）都复用这一条链路。
 */
export async function runScanFlow(
  ctx: BotContext,
  input: ParsedInput,
  opts: ScanFlowOptions = {},
): Promise<void> {
  if (input.kind === 'none') throw new InvalidInputError('unrecognised input');

  const startedAt = Date.now();
  const messageId = opts.editMessageId ?? (await sendPlaceholder(ctx));
  if (messageId === undefined) return;
  const chatId = ctx.chat!.id;
  const key = `${chatId}:${messageId}`;

  // 编辑已有消息：先给即时反馈，用户才知道点击生效了
  if (opts.editMessageId !== undefined) {
    if (inflight.has(key)) return;
    await showBusy(ctx, messageId, opts).catch(() => undefined);
  }
  inflight.add(key);

  try {
    let query: string | undefined = input.kind === 'query' ? input.query : undefined;
    if (input.kind === 'address') {
      try {
        const report = await ctx.services.scan.scanByAddress(input.address, {
          chainSlug: input.chainSlug,
          preferPair: input.pair,
          // 消息里还有 $TICKER：地址查不到先退到 ticker，池子反查放最后
          pairFallback: !input.fallbackQuery,
        });
        const tracked = trackCall(ctx, report, opts);
        await renderReport(ctx, messageId, report, opts);
        recordScan(ctx, report, opts, startedAt);
        await postMilestone(ctx, report, tracked);
        return;
      } catch (err) {
        if (!(err instanceof NotFoundError) || !input.fallbackQuery) throw err;
        ctx.log.info('address not found, falling back to cashtag', { address: input.address, query: input.fallbackQuery });
        query = input.fallbackQuery;
      }
    }

    // 名称 / symbol：先消歧
    const candidates = await ctx.services.search.searchByName(query!, CANDIDATE_LIMIT);
    const top = candidates[0];
    if (!top) throw new InvalidInputError('no search results');

    // 头部结果明显占优（官方收录，或流动性甩开第二名一个量级）时直接出卡片
    if (candidates.length === 1 || isDominant(candidates)) {
      const report = await ctx.services.scan.buildReport(top.candidate, []);
      const tracked = trackCall(ctx, report, opts);
      await renderReport(ctx, messageId, report, opts);
      recordScan(ctx, report, opts, startedAt);
      await postMilestone(ctx, report, tracked);
      return;
    }

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      messageId,
      undefined,
      renderCandidateList(query!, candidates),
      { ...HTML, ...candidateKeyboard(candidates) },
    );
  } catch (err) {
    await ctx.telegram
      .editMessageText(ctx.chat!.id, messageId, undefined, toUserMessage(err))
      .catch(() => undefined);
    throw err;
  } finally {
    inflight.delete(key);
  }
}

async function showBusy(ctx: BotContext, messageId: number, opts: ScanFlowOptions): Promise<void> {
  const chatId = ctx.chat!.id;
  if (opts.busyMode === 'keep') {
    // 刷新：卡片留着，按钮变成不可点的状态提示
    await ctx.telegram.editMessageReplyMarkup(chatId, messageId, undefined, {
      inline_keyboard: [[Markup.button.callback('⏳ Refreshing…', encodeCallback({ action: 'noop' }))]],
    });
    return;
  }
  const text = opts.busyLabel ? `🔍 Scanning ${escapeHtml(opts.busyLabel)}…` : PLACEHOLDER_TEXT;
  await ctx.telegram.editMessageText(chatId, messageId, undefined, text, { ...HTML, reply_markup: { inline_keyboard: [] } });
}

async function sendPlaceholder(ctx: BotContext): Promise<number | undefined> {
  const msg = await ctx.reply(PLACEHOLDER_TEXT, {
    reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined,
  });
  return msg.message_id;
}

async function renderReport(ctx: BotContext, messageId: number, report: TokenReport, opts: ScanFlowOptions = {}): Promise<void> {
  // 群聊与私聊一样直接给完整卡片（紧凑卡 + "Full report" 按钮已按产品决定去掉）
  let text = renderScanCard(report);

  // K 线预览：正文开头放一个零宽不可见链接，Telegram 把图渲染在卡片底部（show_above_text: false）
  // Refresh 时强制重画 K 线（否则 5 分钟内 URL 相同，Telegram 复用旧图）
  const chartUrl = ctx.services.chart.register(report.primary, { fresh: opts.trigger === 'refresh' });
  const preview = chartUrl
    ? { link_preview_options: { is_disabled: false, url: chartUrl, show_above_text: false, prefer_large_media: true } }
    : {};
  if (chartUrl) text = `<a href="${chartUrl}">&#8205;</a>${text}`;

  const extra = { ...HTML, ...preview, ...scanCardKeyboard(report, Boolean(ctx.services.portfolio)) };
  await ctx.telegram.editMessageText(ctx.chat!.id, messageId, undefined, text, extra);
  // Refresh 也走这里，所以缓存里永远是最近一次渲染的版本
  const p = report.primary;
  cardCache.set(`${ctx.chat!.id}:${messageId}`, {
    text,
    extra,
    snapshot: {
      cmcId: p.cmcId,
      symbol: p.symbol,
      name: p.name,
      networkSlug: p.networkSlug,
      address: p.address,
      priceUsd: p.priceUsd,
      marketCapUsd: report.core?.marketCapUsd ?? p.fdvUsd,
    },
  });
}

/**
 * 群内 call 追踪（PRD F3e）：消息触发的扫描可以创建首次 call（谁贴的算谁的）；按钮回调只更新倍数 / 峰值。
 * 市值口径：优先真实流通市值，没有就 FDV，前后比较必须同口径（callService 里校验）。
 * 任何异常都吞掉 —— 这是卡片的附加信息，不能影响出卡。
 */
function trackCall(ctx: BotContext, report: TokenReport, opts: ScanFlowOptions): TrackResult | undefined {
  const calls = ctx.services.calls;
  if (!calls || !isGroup(ctx) || ctx.chat === undefined) return undefined;
  const p = report.primary;
  const mc = report.core?.marketCapUsd;
  const mcapUsd = mc !== undefined && mc > 0 ? mc : p.fdvUsd;
  const mcapKind: 'mc' | 'fdv' = mc !== undefined && mc > 0 ? 'mc' : 'fdv';
  if (mcapUsd === undefined || mcapUsd <= 0) return undefined;
  // 消息触发：贴地址的人 + 那条消息；回调触发且 recordCall：点按钮的人 + 卡片消息
  const fromMessage = opts.editMessageId === undefined && ctx.message !== undefined;
  const canCreate = ctx.from !== undefined && (fromMessage || opts.recordCall === true);
  const callMessageId = fromMessage ? ctx.message!.message_id : opts.editMessageId;
  try {
    const result = calls.track({
      chatId: ctx.chat.id,
      token: { networkSlug: p.networkSlug, address: p.address, symbol: p.symbol },
      mcapUsd,
      mcapKind,
      caller: canCreate
        ? { userId: ctx.from!.id, username: ctx.from!.username, displayName: [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(' ') || ctx.from!.username || 'anon' }
        : undefined,
      messageId: canCreate ? callMessageId : undefined,
    });
    if (result) report.call = result.summary;
    return result;
  } catch (err) {
    ctx.log.warn('call tracking failed', { err: String(err) });
    return undefined;
  }
}

/** 使用统计：一次出卡一行。 */
function recordScan(ctx: BotContext, report: TokenReport, opts: ScanFlowOptions, startedAt: number): void {
  ctx.services.stats?.record({
    kind: 'scan',
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
    chatType: ctx.chat?.type,
    trigger: opts.trigger ?? (opts.editMessageId !== undefined ? 'refresh' : 'address'),
    token: `${report.primary.networkSlug}:${report.primary.symbol}`,
    elapsedMs: Date.now() - startedAt,
    degraded: report.degraded.length > 0,
  });
}

/** 跨过新里程碑：发横幅图，回复到原 call 消息；失败只记日志。 */
async function postMilestone(ctx: BotContext, report: TokenReport, tracked: TrackResult | undefined): Promise<void> {
  if (!tracked?.milestone || !report.call || ctx.chat === undefined) return;
  const c = report.call;
  const p = report.primary;
  try {
    const png = renderBannerPng({
      symbol: p.symbol,
      multiple: c.multiple,
      calledMcapUsd: c.mcapUsd,
      calledAt: c.calledAt,
      callerName: c.username ?? c.displayName,
      logoDataUri: await ctx.services.chart.logoDataUri(p.logo),
    });
    const who = c.username ? `<a href="${userLink(c.username)}">${escapeHtml(c.username)}</a>` : `<b>${escapeHtml(c.displayName)}</b>`;
    const caption = [
      `🚀 <b>$${escapeHtml(p.symbol)}</b> · <b>${formatMultiple(c.multiple)}</b>`,
      `${who} @ ${formatUsdShort(c.mcapUsd)} (${formatCallAge(c.calledAt)})`,
      `<code>${escapeHtml(p.address)}</code>`,
    ].join('\n');
    const base = { caption, parse_mode: 'HTML' as const };
    try {
      await ctx.telegram.sendPhoto(ctx.chat.id, { source: png }, tracked.callMessageId ? { ...base, reply_parameters: { message_id: tracked.callMessageId } } : base);
    } catch {
      // 原消息可能已被删除：不引用重发一次
      await ctx.telegram.sendPhoto(ctx.chat.id, { source: png }, base);
    }
    ctx.log.info('milestone banner sent', { symbol: p.symbol, milestone: tracked.milestone });
  } catch (err) {
    ctx.log.warn('milestone banner failed', { err: String(err) });
  }
}

/** 第一名流动性 ≥ 第二名 10 倍，或第一名是官方收录而第二名不是。 */
function isDominant(candidates: ScoredCandidate[]): boolean {
  const [first, second] = candidates;
  if (!first || !second) return true;
  if (first.candidate.officialVerified && !second.candidate.officialVerified) return true;
  const a = first.candidate.liquidityUsd ?? 0;
  const b = second.candidate.liquidityUsd ?? 0;
  return b > 0 && a / b >= 10;
}
