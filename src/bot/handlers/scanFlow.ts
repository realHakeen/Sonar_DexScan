import { Markup } from 'telegraf';
import { CANDIDATE_LIMIT, PLACEHOLDER_TEXT } from '../../config/constants.js';
import { InvalidInputError, toUserMessage } from '../../infra/errors.js';
import type { ParsedInput } from '../../domain/inputParser.js';
import type { ScoredCandidate } from '../../domain/ranking.js';
import type { TokenReport } from '../../domain/types.js';
import { renderCompactCard, renderScanCard } from '../../render/card.js';
import { escapeHtml } from '../../render/format.js';
import { renderCandidateList } from '../../render/candidates.js';
import { candidateKeyboard, scanCardKeyboard } from '../../render/keyboards.js';
import { encodeCallback } from '../callbackData.js';
import { isGroup, type BotContext } from '../context.js';

const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

export interface ScanFlowOptions {
  /** 已有消息 id 时走编辑，否则先发占位消息。用于按钮回调。 */
  editMessageId?: number;
  /** 强制完整卡片（群里点「展开」时用）。 */
  forceFull?: boolean;
  /**
   * 编辑已有消息时的即时反馈方式：
   * - 'replace'：整条消息换成占位文案并撤掉按钮（候选选择 / 切链 / 展开）
   * - 'keep'：保留原卡片，只把按钮换成「⏳ Refreshing…」（刷新）
   */
  busyMode?: 'replace' | 'keep';
  /** 占位文案里的上下文，如 "TRIA · BNB Chain"。 */
  busyLabel?: string;
}

/** 正在扫描中的消息，key = chatId:messageId。防止用户连点导致重复请求。 */
const inflight = new Set<string>();

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
    if (input.kind === 'address') {
      const report = await ctx.services.scan.scanByAddress(input.address, {
        chainSlug: input.chainSlug,
      });
      await renderReport(ctx, messageId, report, opts.forceFull);
      return;
    }

    // 名称 / symbol：先消歧
    const candidates = await ctx.services.search.searchByName(input.query, CANDIDATE_LIMIT);
    const top = candidates[0];
    if (!top) throw new InvalidInputError('no search results');

    // 头部结果明显占优（官方收录，或流动性甩开第二名一个量级）时直接出卡片
    if (candidates.length === 1 || isDominant(candidates)) {
      const report = await ctx.services.scan.buildReport(top.candidate, []);
      await renderReport(ctx, messageId, report, opts.forceFull);
      return;
    }

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      messageId,
      undefined,
      renderCandidateList(input.query, candidates),
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

async function renderReport(
  ctx: BotContext,
  messageId: number,
  report: TokenReport,
  forceFull = false,
): Promise<void> {
  const compact = isGroup(ctx) && !forceFull;
  let text = compact ? renderCompactCard(report) : renderScanCard(report);

  // K 线预览：正文开头放一个零宽不可见链接，让 Telegram 把图渲染在卡片上方
  const chartUrl = ctx.services.chart.register(report.primary);
  const preview = chartUrl
    ? { link_preview_options: { is_disabled: false, url: chartUrl, show_above_text: true, prefer_large_media: true } }
    : {};
  if (chartUrl) text = `<a href="${chartUrl}">&#8205;</a>${text}`;

  const keyboard = compact
    ? Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '📋 Full report',
            encodeCallback({
              action: 'scan',
              networkSlug: report.primary.networkSlug,
              address: report.primary.address,
              symbol: report.primary.symbol,
            }),
          ),
        ],
      ])
    : scanCardKeyboard(report);

  await ctx.telegram.editMessageText(ctx.chat!.id, messageId, undefined, text, {
    ...HTML,
    ...preview,
    ...keyboard,
  });
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
